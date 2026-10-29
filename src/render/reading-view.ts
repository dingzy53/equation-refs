/**
 * Reading view, embeds, hover previews and PDF export: number linked equations
 * and show unaliased links to them as their numbers.
 */

import { MarkdownPostProcessor, MarkdownPostProcessorContext, MarkdownRenderChild, TFile, parseLinktext } from 'obsidian';
import type { Restorable } from '../constants';
import { blockIdFromSubpath } from '../core/links';
import { linesOf, scanMathBlocks } from '../core/math-source';
import type EquationRefsPlugin from '../main';
import { DISPLAY_MATH, setEquationNumber } from './dom';

interface EquationTarget {
	path: string;
	id: string;
}

export function createReadingViewProcessor(plugin: EquationRefsPlugin): MarkdownPostProcessor {
	return (el, ctx) => {
		numberEquations(plugin, el, ctx);
		formatReferenceLinks(plugin, el, ctx);
	};
}

function numberEquations(plugin: EquationRefsPlugin, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
	const mathEls = Array.from(el.querySelectorAll<HTMLElement>(DISPLAY_MATH)).filter((m) => !isNested(m, el));
	if (!mathEls.length) return;

	const targets = equationTargets(plugin, el, ctx, mathEls.length);
	mathEls.forEach((mathEl, i) => {
		// Apply synchronously as well, so that PDF export picks the number up right away.
		const child = new EquationNumberChild(mathEl, plugin, targets[i] ?? null);
		child.apply();
		ctx.addChild(child);
	});
}

/** Math inside quotes, callouts, lists, tables or nested embeds is not a top-level equation. */
function isNested(node: HTMLElement, root: HTMLElement): boolean {
	for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
		if (p.matches('blockquote, li, td, th, .callout, .markdown-embed')) return true;
	}
	return false;
}

/** The block ID of each top-level display equation in `el`, in order. */
function equationTargets(
	plugin: EquationRefsPlugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	count: number,
): (EquationTarget | null)[] {
	const path = ctx.sourcePath;

	// Normal case: read the IDs from the section's own source.
	const info = ctx.getSectionInfo(el);
	if (info) {
		const blocks = scanMathBlocks(linesOf(info.text), info.lineStart, info.lineEnd);
		if (blocks.length === count) return blocks.map((b) => (b.id ? { path, id: b.id } : null));
	}

	// Whole document at once (PDF export): match equations to the note's math sections by order.
	const isPdfExport = el.parentElement?.hasClass('print') ?? false;
	if (info && !isPdfExport) return [];
	const ids = plugin.numbers.equationIds(path);
	if (ids?.length === count) return ids.map((id) => (id ? { path, id } : null));

	return [];
}

/** If `el` is inside an embed such as `![[Note#^id]]`, the note and block it shows. */
function embedTarget(plugin: EquationRefsPlugin, el: HTMLElement, sourcePath: string): { file: TFile; id: string | null } | null {
	const src = el.closest('.internal-embed[src]')?.getAttribute('src');
	if (!src) return null;
	const { path, subpath } = parseLinktext(src);
	const file = path ? plugin.app.metadataCache.getFirstLinkpathDest(path, sourcePath) : plugin.app.vault.getFileByPath(sourcePath);
	return file ? { file, id: blockIdFromSubpath(subpath) } : null;
}

class EquationNumberChild extends MarkdownRenderChild implements Restorable {
	constructor(
		containerEl: HTMLElement,
		private readonly plugin: EquationRefsPlugin,
		private readonly fromSection: EquationTarget | null,
	) {
		super(containerEl);
	}

	onload(): void {
		this.plugin.rendered.add(this);
		const ref = this.plugin.numbers.onChange((path) => {
			if (path === null || path === this.target()?.path) this.apply();
		});
		this.register(() => this.plugin.numbers.offref(ref));
		// Embeds are only attached to the document after post-processing; look again then.
		window.requestAnimationFrame(() => this.apply());
	}

	onunload(): void {
		this.plugin.rendered.delete(this);
	}

	apply(): void {
		const target = this.target();
		setEquationNumber(this.containerEl, target ? this.plugin.numbers.get(target.path, target.id) : undefined);
	}

	restore(): void {
		setEquationNumber(this.containerEl, undefined);
	}

	private target(): EquationTarget | null {
		const embed = embedTarget(this.plugin, this.containerEl, this.fromSection?.path ?? '');
		if (embed) {
			const id = embed.id ?? this.fromSection?.id;
			return id ? { path: embed.file.path, id } : null;
		}
		return this.fromSection;
	}
}

function formatReferenceLinks(plugin: EquationRefsPlugin, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
	for (const link of Array.from(el.querySelectorAll<HTMLElement>('a.internal-link[data-href*="#^"]'))) {
		const href = link.getAttribute('data-href') ?? '';
		const { path, subpath } = parseLinktext(href);
		const id = blockIdFromSubpath(subpath);
		if (!id) continue;
		const original = link.textContent ?? '';
		// Leave aliased links alone: Obsidian shows unaliased block links as "Note > ^id".
		if (original !== href && !original.includes(`^${id}`)) continue;

		const child = new ReferenceLinkChild(link, plugin, ctx.sourcePath, path, id, original);
		child.apply();
		ctx.addChild(child);
	}
}

class ReferenceLinkChild extends MarkdownRenderChild implements Restorable {
	constructor(
		containerEl: HTMLElement,
		private readonly plugin: EquationRefsPlugin,
		private readonly sourcePath: string,
		private readonly linkpath: string,
		private readonly id: string,
		private readonly originalText: string,
	) {
		super(containerEl);
	}

	onload(): void {
		this.plugin.rendered.add(this);
		const ref = this.plugin.numbers.onChange((path) => {
			if (path === null || path === this.targetFile()?.path) this.apply();
		});
		this.register(() => this.plugin.numbers.offref(ref));
	}

	onunload(): void {
		this.plugin.rendered.delete(this);
	}

	apply(): void {
		const target = this.targetFile();
		const label = target ? this.plugin.numbers.get(target.path, this.id) : undefined;
		if (target && label) {
			this.containerEl.setText(this.plugin.referenceText(this.sourcePath, target, label));
			this.containerEl.addClass('eqref-link');
		} else {
			this.restore();
		}
	}

	restore(): void {
		this.containerEl.setText(this.originalText);
		this.containerEl.removeClass('eqref-link');
	}

	private targetFile(): TFile | null {
		const { metadataCache, vault } = this.plugin.app;
		return this.linkpath ? metadataCache.getFirstLinkpathDest(this.linkpath, this.sourcePath) : vault.getFileByPath(this.sourcePath);
	}
}
