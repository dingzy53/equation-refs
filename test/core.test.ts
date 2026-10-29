import { describe, expect, it } from 'vitest';
import { blockAtLine, classifyEquation, linesOf, scanMathBlocks, stripTexComments } from '../src/core/math-source';
import { numberEquations, sameLabels } from '../src/core/numbering';
import { blockIdFromSubpath, findBlockLinks } from '../src/core/links';
import { formatReference, validateTemplate } from '../src/core/format';

describe('scanMathBlocks', () => {
	it('finds multi-line blocks with an ID on the next line', () => {
		const src = linesOf(['intro', '$$', 'a = b', '$$', '^eq-1', '', 'text'].join('\n'));
		expect(scanMathBlocks(src)).toEqual([{ startLine: 1, endLine: 4, id: 'eq-1', tex: 'a = b' }]);
	});

	it('finds single-line blocks with an inline ID', () => {
		const src = linesOf('$$ x^2 $$ ^sq');
		expect(scanMathBlocks(src)).toEqual([{ startLine: 0, endLine: 0, id: 'sq', tex: 'x^2' }]);
	});

	it('accepts an ID right after the closing delimiter', () => {
		const src = linesOf(['$$', 'y', '$$ ^why'].join('\n'));
		expect(scanMathBlocks(src)[0]?.id).toBe('why');
	});

	it('returns null IDs for unlabelled blocks', () => {
		const src = linesOf(['$$', 'y', '$$', 'next paragraph'].join('\n'));
		expect(scanMathBlocks(src)).toEqual([{ startLine: 0, endLine: 2, id: null, tex: 'y' }]);
	});

	it('skips code fences, quotes, lists and frontmatter', () => {
		const src = linesOf([
			'---', 'a: $$', '---',
			'```', '$$', 'in code', '$$', '```',
			'> $$', '> quoted', '> $$',
			'- $$ item $$',
			'$$', 'real', '$$', '^r',
		].join('\n'));
		expect(scanMathBlocks(src).map((b) => b.id)).toEqual(['r']);
	});

	it('stops at an unclosed block', () => {
		expect(scanMathBlocks(linesOf('$$\na\nb'))).toEqual([]);
	});

	it('limits the scan to a line range but looks past it for the ID', () => {
		const src = linesOf(['$$', 'a', '$$', '^a', '', '$$', 'b', '$$', '^b'].join('\n'));
		expect(scanMathBlocks(src, 5, 7).map((b) => b.id)).toEqual(['b']);
	});

	it('maps lines to blocks', () => {
		const blocks = scanMathBlocks(linesOf(['$$', 'a', '$$', '^a', 'after'].join('\n')));
		expect(blockAtLine(blocks, 0)?.id).toBe('a');
		expect(blockAtLine(blocks, 3)?.id).toBe('a');
		expect(blockAtLine(blocks, 4)?.id).toBe('a');
		expect(blockAtLine(blocks, 5)).toBeNull();
	});
});

describe('classifyEquation', () => {
	it('detects automatic, tagged and unnumbered equations', () => {
		expect(classifyEquation('a = b')).toEqual({ kind: 'auto' });
		expect(classifyEquation('a = b \\tag{A.1}')).toEqual({ kind: 'tag', tag: 'A.1' });
		expect(classifyEquation('a = b \\tag*{x}')).toEqual({ kind: 'tag', tag: 'x' });
		expect(classifyEquation('a = b \\notag')).toEqual({ kind: 'none' });
		expect(classifyEquation('a = b \\nonumber')).toEqual({ kind: 'none' });
	});

	it('ignores commands in comments and similar names', () => {
		expect(classifyEquation('a % \\tag{x}')).toEqual({ kind: 'auto' });
		expect(classifyEquation('a \\notagged')).toEqual({ kind: 'auto' });
		expect(stripTexComments('50\\% % note')).toBe('50\\% ');
	});
});

describe('numberEquations', () => {
	const eqs = [
		{ id: 'a', tex: 'a' },
		{ id: 'b', tex: 'b' },
		{ id: null, tex: 'c' },
		{ id: 't', tex: 't \\tag{*}' },
		{ id: 'n', tex: 'n \\notag' },
		{ id: 'd', tex: 'd' },
	];

	it('numbers only referenced equations, in order', () => {
		const labels = numberEquations(eqs, (id) => id !== 'b');
		expect(Object.fromEntries(labels)).toEqual({
			a: { text: '1', tagged: false },
			t: { text: '*', tagged: true },
			d: { text: '2', tagged: false },
		});
	});

	it('numbers nothing when nothing is referenced', () => {
		expect(numberEquations(eqs, () => false).size).toBe(0);
	});

	it('compares label maps', () => {
		const one = numberEquations(eqs, () => true);
		expect(sameLabels(one, numberEquations(eqs, () => true))).toBe(true);
		expect(sameLabels(one, numberEquations(eqs, (id) => id !== 'a'))).toBe(false);
		expect(sameLabels(undefined, new Map())).toBe(true);
	});
});

describe('links', () => {
	it('parses block subpaths', () => {
		expect(blockIdFromSubpath('#^abc-1')).toBe('abc-1');
		expect(blockIdFromSubpath('#heading')).toBeNull();
		expect(blockIdFromSubpath('')).toBeNull();
	});

	it('finds unaliased block links and skips aliases and embeds', () => {
		const text = 'see [[Maxwell#^gauss]], [[#^self]], [[A#^x|alias]], ![[B#^y]], [[C#head]]';
		expect(findBlockLinks(text).map(({ path, id, linktext }) => ({ path, id, linktext }))).toEqual([
			{ path: 'Maxwell', id: 'gauss', linktext: 'Maxwell#^gauss' },
			{ path: '', id: 'self', linktext: '#^self' },
		]);
		const [first] = findBlockLinks(text);
		expect(text.slice(first?.from, first?.to)).toBe('[[Maxwell#^gauss]]');
	});
});

describe('format', () => {
	it('fills templates', () => {
		expect(formatReference('({n})', { n: '3', note: 'Maxwell' })).toBe('(3)');
		expect(formatReference('{note} ({n})', { n: '3', note: 'Maxwell' })).toBe('Maxwell (3)');
	});

	it('validates templates', () => {
		expect(validateTemplate('({n})')).toBeUndefined();
		expect(validateTemplate('(x)')).toBeTypeOf('string');
	});
});
