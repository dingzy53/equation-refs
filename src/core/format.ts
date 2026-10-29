export interface FormatValues {
	/** The equation label without parentheses, e.g. `3`. */
	n: string;
	/** The target note's name. */
	note: string;
}

/** Replace `{n}` and `{note}` in a reference template. */
export function formatReference(template: string, values: FormatValues): string {
	return template.replace(/\{(n|note)\}/g, (_, key: keyof FormatValues) => values[key]);
}

/** An error message for an unusable template, or undefined if it is fine. */
export function validateTemplate(template: string): string | undefined {
	return template.includes('{n}') ? undefined : 'The format must contain {n}.';
}
