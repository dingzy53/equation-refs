/** `#^abc` → `abc`; anything else → null. */
export function blockIdFromSubpath(subpath: string): string | null {
	const match = /^#\^([A-Za-z0-9-]+)$/.exec(subpath);
	return match?.[1] ?? null;
}

export interface BlockLinkMatch {
	/** Offset of `[[` within the scanned text. */
	from: number;
	/** Offset just past `]]`. */
	to: number;
	/** The link text inside the brackets, e.g. `Maxwell#^gauss`. */
	linktext: string;
	/** Note path part; empty for a link within the same note. */
	path: string;
	id: string;
}

/** Wikilinks to a block with no alias: `[[path#^id]]` or `[[#^id]]`. Embeds are excluded. */
export function findBlockLinks(text: string): BlockLinkMatch[] {
	const re = /\[\[([^[\]|#^]*)#\^([A-Za-z0-9-]+)\]\]/g;
	const matches: BlockLinkMatch[] = [];
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		if (m.index > 0 && text.charAt(m.index - 1) === '!') continue;
		const path = m[1] ?? '';
		const id = m[2] ?? '';
		matches.push({ from: m.index, to: m.index + m[0].length, linktext: `${path}#^${id}`, path, id });
	}
	return matches;
}
