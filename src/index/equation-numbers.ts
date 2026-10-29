import { App, CachedMetadata, Component, EventRef, Events, TFile, debounce } from 'obsidian';
import { EquationLabel, numberEquations, sameLabels } from '../core/numbering';
import { ReferenceIndex } from './reference-index';

const ONE_LINE_MATH_RE = /^ {0,3}\$\$[^\n]*\$\$\s*(\^[A-Za-z0-9-]+\s*)?$/;

/**
 * Keeps the equation numbers of every note that has linked equations, and
 * triggers `changed` (with the note path, or null for "everything") when they change.
 *
 * Numbers are computed ahead of time so that renderers, including PDF export, can read them synchronously.
 */
export class EquationNumbers extends Component {
	private readonly refs: ReferenceIndex;
	private readonly events = new Events();
	private labels = new Map<string, Map<string, EquationLabel>>();
	/** Block IDs of the display equations of numbered notes, in document order (null when unlabelled). */
	private order = new Map<string, (string | null)[]>();
	/** Guards against out-of-order async recomputes of the same note. */
	private generation = new Map<string, number>();
	private readonly scheduleRebuild = debounce(() => void this.rebuild(), 500, true);

	constructor(private app: App) {
		super();
		this.refs = new ReferenceIndex(app);
	}

	onload(): void {
		this.app.workspace.onLayoutReady(() => {
			void this.rebuild();

			const { metadataCache, vault } = this.app;
			// The cache may still be indexing at startup; rebuild once it has resolved everything.
			const firstResolve = metadataCache.on('resolved', () => {
				metadataCache.offref(firstResolve);
				this.scheduleRebuild();
			});
			this.registerEvent(firstResolve);
			this.registerEvent(metadataCache.on('changed', (file, data, cache) => this.onChanged(file, data, cache)));
			this.registerEvent(metadataCache.on('deleted', (file) => this.onDeleted(file.path)));
			// Renames and new notes can change how links resolve; these are rare, so rebuild.
			this.registerEvent(vault.on('rename', (_file, oldPath) => {
				this.onDeleted(oldPath);
				this.scheduleRebuild();
			}));
			this.registerEvent(vault.on('create', () => this.scheduleRebuild()));
		});
	}

	onunload(): void {
		this.scheduleRebuild.cancel();
	}

	get(path: string, id: string): EquationLabel | undefined {
		return this.labels.get(path)?.get(id);
	}

	/** IDs of a numbered note's display equations in document order, for matching rendered equations by position. */
	equationIds(path: string): readonly (string | null)[] | undefined {
		return this.order.get(path);
	}

	/** `callback(path)` runs when the numbers of `path` change; `path` is null when everything should refresh. */
	onChange(callback: (path: string | null) => void): EventRef {
		return this.events.on('changed', callback as (...data: unknown[]) => unknown);
	}

	offref(ref: EventRef): void {
		this.events.offref(ref);
	}

	/** Ask every view to redraw, e.g. after a settings change. */
	refreshAll(): void {
		this.events.trigger('changed', null);
	}

	private async rebuild(): Promise<void> {
		this.refs.clear();
		// Walk the metadata cache's link graph rather than listing vault files.
		const { metadataCache, vault } = this.app;
		for (const path of Object.keys(metadataCache.resolvedLinks)) {
			const file = vault.getFileByPath(path);
			if (file) this.refs.updateSource(file);
		}
		const paths = new Set([...this.labels.keys(), ...this.refs.targets()]);
		await Promise.all([...paths].map((path) => this.recompute(path)));
	}

	private onChanged(file: TFile, data: string, cache: CachedMetadata): void {
		const affected = this.refs.updateSource(file);
		affected.add(file.path);
		for (const path of affected) void this.recompute(path, path === file.path ? { data, cache } : undefined);
	}

	private onDeleted(path: string): void {
		this.generation.delete(path);
		this.order.delete(path);
		if (this.labels.delete(path)) this.events.trigger('changed', path);
		for (const target of this.refs.removeSource(path)) void this.recompute(target);
	}

	private async recompute(path: string, known?: { data: string; cache: CachedMetadata }): Promise<void> {
		const gen = (this.generation.get(path) ?? 0) + 1;
		this.generation.set(path, gen);

		let next: Map<string, EquationLabel> | undefined;
		let ids: (string | null)[] = [];
		const file = this.app.vault.getFileByPath(path);
		if (file && this.refs.hasReferences(path)) {
			try {
				const cache = known?.cache ?? this.app.metadataCache.getFileCache(file);
				const sections = cache?.sections?.filter((s) => s.type === 'math' || s.type === 'paragraph') ?? [];
				if (sections.some((s) => s.type === 'math' || s.id)) {
					const data = known?.data ?? (await this.app.vault.cachedRead(file));
					const equations = sections
						.map((s) => ({ ...s, text: data.slice(s.position.start.offset, s.position.end.offset) }))
						// A one-line `$$ … $$ ^id` is parsed as a paragraph, but it renders as display math.
						.filter((s) => s.type === 'math' || ONE_LINE_MATH_RE.test(s.text))
						.map((s) => ({ id: s.id, tex: s.text }));
					next = numberEquations(equations, (id) => this.refs.isReferenced(path, id));
					ids = equations.map((e) => e.id ?? null);
				}
			} catch (err) {
				console.error(`Equation Refs: failed to number equations in ${path}`, err);
			}
		}
		if (this.generation.get(path) !== gen) return; // a newer recompute is in flight

		const prev = this.labels.get(path);
		if (next?.size) {
			this.labels.set(path, next);
			this.order.set(path, ids);
		} else {
			this.labels.delete(path);
			this.order.delete(path);
		}
		if (!sameLabels(prev, next)) this.events.trigger('changed', path);
	}
}
