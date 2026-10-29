/**
 * Live Preview: number linked equations by setting an attribute on the math widgets Obsidian renders.
 */

import { Text } from '@codemirror/state';
import { EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EventRef, editorInfoField } from 'obsidian';
import { MathBlockInfo, blockAtLine, scanMathBlocks } from '../../core/math-source';
import { EquationLabel } from '../../core/numbering';
import type EquationRefsPlugin from '../../main';
import { DISPLAY_MATH, setEquationNumber } from '../dom';

/** Block widgets for `$$` blocks, plus one-line `$$ … $$` rendered inside a line. */
const BLOCK_MATH = `:scope > .cm-embed-block.math ${DISPLAY_MATH}`;
const LINE_MATH = `:scope > .cm-line ${DISPLAY_MATH}`;
const TOP_LEVEL_MATH = `${BLOCK_MATH}, ${LINE_MATH}`;

export function equationNumbersInEditor(plugin: EquationRefsPlugin): ViewPlugin<PluginValue> {
	return ViewPlugin.define((view) => new EquationNumbersView(view, plugin));
}

class EquationNumbersView implements PluginValue {
	private readonly ref: EventRef;
	private blocks: MathBlockInfo[] = [];
	private blocksDoc: Text | null = null;

	constructor(
		private readonly view: EditorView,
		private readonly plugin: EquationRefsPlugin,
	) {
		this.ref = plugin.numbers.onChange(() => this.schedule());
		this.schedule();
	}

	update(update: ViewUpdate): void {
		if (update.docChanged || update.viewportChanged || update.geometryChanged) this.schedule();
	}

	destroy(): void {
		this.plugin.numbers.offref(this.ref);
		for (const mathEl of this.mathEls()) setEquationNumber(mathEl, undefined);
	}

	private mathEls(): HTMLElement[] {
		return Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(TOP_LEVEL_MATH));
	}

	private schedule(): void {
		this.view.requestMeasure({
			key: this,
			read: () => this.read(),
			write: (items) => {
				for (const [mathEl, label] of items) setEquationNumber(mathEl, label);
			},
		});
	}

	private read(): [HTMLElement, EquationLabel | undefined][] {
		const { state } = this.view;
		const path = state.field(editorInfoField, false)?.file?.path;
		const doc = state.doc;
		if (this.blocksDoc !== doc) {
			this.blocks = scanMathBlocks({ lineCount: doc.lines, line: (i) => doc.line(i + 1).text });
			this.blocksDoc = doc;
		}

		return this.mathEls().map((mathEl) => {
			if (!path) return [mathEl, undefined];
			try {
				const line = doc.lineAt(this.view.posAtDOM(mathEl)).number - 1;
				let block = blockAtLine(this.blocks, line);
				// Inline-rendered math must sit on the block's own lines, not just after it.
				if (block && mathEl.closest('.cm-line') && line > block.endLine) block = null;
				const id = block?.id;
				return [mathEl, id ? this.plugin.numbers.get(path, id) : undefined];
			} catch {
				// posAtDOM can throw while the widget is being replaced; the next update catches up.
				return [mathEl, undefined];
			}
		});
	}
}
