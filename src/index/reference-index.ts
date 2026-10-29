import { App, TFile, parseLinktext } from 'obsidian';
import { blockIdFromSubpath } from '../core/links';

const SEP = '\u0000';

/**
 * Reverse index of block links: which block IDs of each note are linked to from anywhere in the vault.
 * Built from Obsidian's metadata cache only; note contents are never read here.
 */
export class ReferenceIndex {
	/** source path → keys (`target\0id`) of the block links it contains */
	private outgoing = new Map<string, Set<string>>();
	/** target path → block ID → number of links */
	private counts = new Map<string, Map<string, number>>();

	constructor(private app: App) {}

	isReferenced(targetPath: string, id: string): boolean {
		return (this.counts.get(targetPath)?.get(id) ?? 0) > 0;
	}

	hasReferences(targetPath: string): boolean {
		return this.counts.has(targetPath);
	}

	targets(): string[] {
		return [...this.counts.keys()];
	}

	clear(): void {
		this.outgoing.clear();
		this.counts.clear();
	}

	/** Re-read the links of `file`. Returns the target paths whose references changed. */
	updateSource(file: TFile): Set<string> {
		const next = this.collectKeys(file);
		const prev = this.outgoing.get(file.path) ?? new Set<string>();
		const affected = new Set<string>();
		for (const key of prev) if (!next.has(key)) affected.add(this.adjust(key, -1));
		for (const key of next) if (!prev.has(key)) affected.add(this.adjust(key, +1));
		if (next.size) this.outgoing.set(file.path, next);
		else this.outgoing.delete(file.path);
		return affected;
	}

	/** Forget the links of a deleted note. Returns the affected target paths. */
	removeSource(path: string): Set<string> {
		const affected = new Set<string>();
		for (const key of this.outgoing.get(path) ?? []) affected.add(this.adjust(key, -1));
		this.outgoing.delete(path);
		return affected;
	}

	private collectKeys(file: TFile): Set<string> {
		const keys = new Set<string>();
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return keys;
		for (const ref of [...(cache.links ?? []), ...(cache.frontmatterLinks ?? [])]) {
			const { path, subpath } = parseLinktext(ref.link);
			const id = blockIdFromSubpath(subpath);
			if (!id) continue;
			const target = path ? this.app.metadataCache.getFirstLinkpathDest(path, file.path) : file;
			if (target) keys.add(target.path + SEP + id);
		}
		return keys;
	}

	/** Change the link count for `key` and return its target path. */
	private adjust(key: string, delta: number): string {
		const sep = key.indexOf(SEP);
		const target = key.slice(0, sep);
		const id = key.slice(sep + 1);
		const ids = this.counts.get(target) ?? new Map<string, number>();
		const count = (ids.get(id) ?? 0) + delta;
		if (count > 0) ids.set(id, count);
		else ids.delete(id);
		if (ids.size) this.counts.set(target, ids);
		else this.counts.delete(target);
		return target;
	}
}
