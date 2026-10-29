/**
 * Live Preview: show unaliased links to numbered equations as their numbers.
 * The raw link comes back while the cursor is inside it.
 */

import { syntaxTree } from '@codemirror/language';
import { EditorState, RangeSetBuilder, StateEffect } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, PluginValue, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { EventRef, HoverParent, Keymap, editorInfoField, editorLivePreviewField } from 'obsidian';
import { HOVER_SOURCE } from '../../constants';
import { findBlockLinks } from '../../core/links';
import type EquationRefsPlugin from '../../main';

const refresh = StateEffect.define<null>();

export function referenceLinksInEditor(plugin: EquationRefsPlugin): ViewPlugin<ReferenceLinksView> {
	return ViewPlugin.define((view) => new ReferenceLinksView(view, plugin), {
		decorations: (value) => value.decorations,
	});
}

class ReferenceLinksView implements PluginValue {
	decorations: DecorationSet;
	private readonly ref: EventRef;
	private destroyed = false;

	constructor(
		view: EditorView,
		private readonly plugin: EquationRefsPlugin,
	) {
		this.decorations = this.build(view);
		this.ref = plugin.numbers.onChange(() => {
			// Never dispatch from inside another editor update.
			window.setTimeout(() => {
				if (!this.destroyed) view.dispatch({ effects: refresh.of(null) });
			});
		});
	}

	update(update: ViewUpdate): void {
		if (
			update.docChanged ||
			update.viewportChanged ||
			update.selectionSet ||
			update.focusChanged ||
			isLivePreview(update.startState) !== isLivePreview(update.state) ||
			update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))
		) {
			this.decorations = this.build(update.view);
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.plugin.numbers.offref(this.ref);
	}

	private build(view: EditorView): DecorationSet {
		const { state } = view;
		const source = state.field(editorInfoField, false)?.file;
		if (!source || !isLivePreview(state)) return Decoration.none;

		const { metadataCache } = this.plugin.app;
		const builder = new RangeSetBuilder<Decoration>();
		const tree = syntaxTree(state);

		for (const { from, to } of view.visibleRanges) {
			for (const link of findBlockLinks(state.sliceDoc(from, to))) {
				const start = from + link.from;
				const end = from + link.to;
				if (state.selection.ranges.some((r) => r.from <= end && r.to >= start)) continue;
				if (/code|math|comment/.test(tree.resolveInner(start, 1).name)) continue;

				const target = link.path ? metadataCache.getFirstLinkpathDest(link.path, source.path) : source;
				const label = target ? this.plugin.numbers.get(target.path, link.id) : undefined;
				if (!target || !label) continue;

				const text = this.plugin.referenceText(source.path, target, label);
				builder.add(start, end, Decoration.replace({
					widget: new ReferenceWidget(this.plugin, text, link.linktext, source.path),
				}));
			}
		}
		return builder.finish();
	}
}

function isLivePreview(state: EditorState): boolean {
	return state.field(editorLivePreviewField, false) ?? false;
}

class ReferenceWidget extends WidgetType {
	constructor(
		private readonly plugin: EquationRefsPlugin,
		readonly text: string,
		readonly linktext: string,
		readonly sourcePath: string,
	) {
		super();
	}

	eq(other: ReferenceWidget): boolean {
		return other.text === this.text && other.linktext === this.linktext && other.sourcePath === this.sourcePath;
	}

	toDOM(): HTMLElement {
		const { workspace } = this.plugin.app;
		const hoverParent: HoverParent = { hoverPopover: null };
		const el = createSpan({ cls: 'cm-hmd-internal-link eqref-link' });
		el.createSpan({ cls: 'cm-underline', text: this.text });
		el.addEventListener('click', (evt) => {
			evt.preventDefault();
			void workspace.openLinkText(this.linktext, this.sourcePath, Keymap.isModEvent(evt));
		});
		el.addEventListener('mouseover', (evt) => {
			workspace.trigger('hover-link', {
				event: evt,
				source: HOVER_SOURCE,
				hoverParent,
				targetEl: el,
				linktext: this.linktext,
				sourcePath: this.sourcePath,
			});
		});
		return el;
	}

	/** Let the widget handle its own mouse events instead of moving the cursor into the link. */
	ignoreEvent(): boolean {
		return true;
	}
}
