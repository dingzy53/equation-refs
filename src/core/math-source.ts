/**
 * Pure helpers for reading display math (`$$ … $$`) out of Markdown source.
 * No Obsidian imports, so everything here is unit-testable.
 */

/** Line-based view over a document: an array of strings or a CodeMirror `Text`. */
export interface LineSource {
	readonly lineCount: number;
	/** 0-based line access. */
	line(index: number): string;
}

export function linesOf(text: string): LineSource {
	const lines = text.split('\n');
	return { lineCount: lines.length, line: (i) => lines[i] ?? '' };
}

export interface MathBlockInfo {
	/** 0-based line of the opening `$$`. */
	startLine: number;
	/** 0-based last line of the block, including a trailing `^id` line. */
	endLine: number;
	/** The block ID (`^id`), if any. */
	id: string | null;
	/** The TeX source between the delimiters. */
	tex: string;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_OPEN_RE = /^ {0,3}\$\$/;
const BLOCK_ID_LINE_RE = /^\s*\^([A-Za-z0-9-]+)\s*$/;

/**
 * Find top-level display math blocks whose opening line is in `[from, to]`.
 * Blocks inside code fences, block quotes, callouts and lists are not top-level and are skipped.
 * A trailing block ID is looked up even if it lies past `to`.
 */
export function scanMathBlocks(src: LineSource, from = 0, to = src.lineCount - 1): MathBlockInfo[] {
	const blocks: MathBlockInfo[] = [];
	const n = src.lineCount;
	let i = Math.max(0, from === 0 ? frontmatterEnd(src) : from);
	let fence: string | null = null;

	for (; i <= to && i < n; i++) {
		const line = src.line(i);

		const fenceMatch = FENCE_RE.exec(line);
		if (fence !== null) {
			if (fenceMatch?.[1] && isClosingFence(line, fence)) fence = null;
			continue;
		}
		if (fenceMatch?.[1]) {
			fence = fenceMatch[1];
			continue;
		}

		const open = MATH_OPEN_RE.exec(line);
		if (!open) continue;

		const rest = line.slice(open[0].length);
		let endLine: number;
		let tex: string;
		let afterClose: string;

		const sameLineClose = rest.indexOf('$$');
		if (sameLineClose >= 0) {
			endLine = i;
			tex = rest.slice(0, sameLineClose);
			afterClose = rest.slice(sameLineClose + 2);
		} else {
			const texLines = [rest];
			let j = i + 1;
			while (j < n && !src.line(j).includes('$$')) texLines.push(src.line(j++));
			if (j >= n) break; // unclosed block: nothing after it can be math either
			const closing = src.line(j);
			const k = closing.indexOf('$$');
			texLines.push(closing.slice(0, k));
			tex = texLines.join('\n');
			afterClose = closing.slice(k + 2);
			endLine = j;
		}

		let id = BLOCK_ID_LINE_RE.exec(afterClose)?.[1] ?? null;
		if (id === null && endLine + 1 < n) {
			const next = BLOCK_ID_LINE_RE.exec(src.line(endLine + 1));
			if (next?.[1]) {
				id = next[1];
				endLine++;
			}
		}

		blocks.push({ startLine: i, endLine, id, tex: tex.trim() });
		i = endLine;
	}
	return blocks;
}

/** The block whose lines contain `line`, or which ends on the line just before it. */
export function blockAtLine(blocks: readonly MathBlockInfo[], line: number): MathBlockInfo | null {
	for (const block of blocks) {
		if (block.startLine <= line && line <= block.endLine + 1) return block;
	}
	return null;
}

function frontmatterEnd(src: LineSource): number {
	if (src.lineCount === 0 || src.line(0).trimEnd() !== '---') return 0;
	for (let i = 1; i < src.lineCount; i++) {
		if (/^(---|\.\.\.)\s*$/.test(src.line(i))) return i + 1;
	}
	return 0;
}

function isClosingFence(line: string, fence: string): boolean {
	const trimmed = line.trim();
	const char = fence.charAt(0);
	return trimmed.length >= fence.length && [...trimmed].every((c) => c === char);
}

export type EquationKind =
	| { kind: 'auto' }
	| { kind: 'tag'; tag: string }
	| { kind: 'none' };

const TAG_RE = /\\tag\*?\s*\{([^{}]*)\}/;
const NOTAG_RE = /\\(?:notag|nonumber)(?![A-Za-z])/;

/** How an equation wants to be numbered, judged from its TeX source (comments ignored). */
export function classifyEquation(tex: string): EquationKind {
	const code = stripTexComments(tex);
	const tag = TAG_RE.exec(code);
	if (tag) return { kind: 'tag', tag: (tag[1] ?? '').trim() };
	if (NOTAG_RE.test(code)) return { kind: 'none' };
	return { kind: 'auto' };
}

/** Remove `% …` comments, keeping escaped `\%`. */
export function stripTexComments(tex: string): string {
	return tex
		.split('\n')
		.map((line) => {
			for (let i = 0; i < line.length; i++) {
				if (line[i] === '\\') i++;
				else if (line[i] === '%') return line.slice(0, i);
			}
			return line;
		})
		.join('\n');
}
