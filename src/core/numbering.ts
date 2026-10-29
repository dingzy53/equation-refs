import { classifyEquation } from './math-source';

export interface EquationLabel {
	/** What goes inside the parentheses, e.g. `3` or a manual tag such as `A.1`. */
	text: string;
	/** True if the label comes from a manual `\tag{}`, which MathJax already draws. */
	tagged: boolean;
}

export interface EquationSource {
	id?: string | null;
	tex: string;
}

/**
 * Number the referenced equations of one note, in document order.
 * Unreferenced and `\notag` equations get no label; `\tag{x}` equations keep `x`
 * and do not advance the counter.
 */
export function numberEquations(
	equations: readonly EquationSource[],
	isReferenced: (id: string) => boolean,
): Map<string, EquationLabel> {
	const labels = new Map<string, EquationLabel>();
	let counter = 0;
	for (const { id, tex } of equations) {
		if (!id || labels.has(id) || !isReferenced(id)) continue;
		const kind = classifyEquation(tex);
		if (kind.kind === 'tag') labels.set(id, { text: kind.tag, tagged: true });
		else if (kind.kind === 'auto') labels.set(id, { text: String(++counter), tagged: false });
	}
	return labels;
}

export function sameLabels(a: ReadonlyMap<string, EquationLabel> | undefined, b: ReadonlyMap<string, EquationLabel> | undefined): boolean {
	if ((a?.size ?? 0) !== (b?.size ?? 0)) return false;
	if (!a || !b) return true;
	for (const [id, label] of a) {
		const other = b.get(id);
		if (!other || other.text !== label.text || other.tagged !== label.tagged) return false;
	}
	return true;
}
