import { EquationLabel } from '../core/numbering';

export const DISPLAY_MATH = 'mjx-container.MathJax[display="true"]';
const NUMBER_ATTR = 'data-eq-number';
const NUMBERED_CLASS = 'eqref-numbered';

/** Show `(label)` next to a display equation via CSS, or remove it. MathJax is never re-run. */
export function setEquationNumber(mathEl: HTMLElement, label: EquationLabel | undefined): void {
	const text = label && !label.tagged ? `(${label.text})` : null;
	if (mathEl.getAttribute(NUMBER_ATTR) === text) return;
	if (text === null) {
		mathEl.removeAttribute(NUMBER_ATTR);
		mathEl.removeClass(NUMBERED_CLASS);
	} else {
		mathEl.setAttribute(NUMBER_ATTR, text);
		mathEl.addClass(NUMBERED_CLASS);
	}
}
