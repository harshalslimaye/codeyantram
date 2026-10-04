import {stripVTControlCharacters} from 'node:util';
import {describe, expect, it} from 'vitest';
import {createMarkdownRenderer} from '../../src/terminal/markdown.js';
import {THEME_ROLES} from '../../src/theme/registry/types.js';
import type {InkThemePalette} from '../../src/theme/provider.js';

const mono = Object.fromEntries(THEME_ROLES.map(role => [role, undefined])) as InkThemePalette;
const render = (source: string, width = 60) => createMarkdownRenderer(width, mono)(source);

describe('terminal Markdown', () => {
	it('renders headings, inline styles, lists, quotes, links, and literal code', () => {
		const source = '# Heading\n\n**Bold** and *italic*, ~~removed~~ and `a < b`.\n\n- **First**\n- `second`\n\n> Quoted\n\n[Docs](https://example.com)\n\n```js\nconst x = "**literal**";\n```';
		const output = render(source).join('\n');
		expect(output).toContain('Heading');
		expect(output).toContain('Bold and italic, removed and a < b.');
		expect(output).toContain('* First');
		expect(output).toContain('* second');
		expect(output).toContain('Quoted');
		expect(output).toContain('Docs (https://example.com)');
		expect(output).toContain('const x = "**literal**";');
		expect(output).not.toMatch(/# Heading|\*\*Bold\*\*|```|\x1b/);
	});

	it('keeps plain multiline replies and incomplete streamed fences readable', () => {
		expect(render('First line\nSecond line')).toEqual(['First line', 'Second line']);
		const renderer = createMarkdownRenderer(40, mono);
		const partial = 'Before\n\n```typescript\nconst value = 1;';
		expect(renderer(partial).join('\n')).toContain('  const value = 1;');
		expect(renderer(partial + '\n```').join('\n')).toContain('  const value = 1;');
		expect(renderer(partial + '\n```').join('\n')).not.toContain('```');
		expect(renderer('**unfinished').join('\n')).toContain('unfinished');
		expect(renderer('**unfinished**')).toEqual(['unfinished']);
	});

	it('wraps tables to the available width and stacks cells in very narrow terminals', () => {
		const source = '| Name | Description |\n| --- | --- |\n| Widget | A lengthy explanation with several words |';
		const rows = render(source, 30);
		expect(rows.every(row => stripVTControlCharacters(row).length <= 30)).toBe(true);
		expect(rows.join('\n')).toContain('Widget');
		expect(rows.join('\n')).toContain('explanation');
		const narrow = render(source, 10);
		expect(narrow.every(row => row.length <= 10)).toBe(true);
		expect(narrow.join('\n')).toContain('Name:');
		expect(narrow.join('\n')).toContain('Widget');
	});

	it('retains long table values instead of truncating them', () => {
		const value = '/src/components/a-very-long-component-filename.tsx';
		const rows = render(`| File | Code |\n| --- | --- |\n| ${value} | \`a:b\` |`, 30);
		expect(rows.join('').replace(/\s+/g, '')).toContain(value);
		expect(rows.join('\n')).toContain('a:b');
		expect(rows.join('\n')).not.toContain('…');
		expect(rows.every(row => row.length <= 30)).toBe(true);
		expect(render('| Header |\n| --- |', 6).join('')).toBe('Header');
	});

	it.each(['#83A598', 'ansi256(109)'])('uses theme colors and restores styles on every wrapped row (%s)', color => {
		const palette = {...mono, text: color, primary: color, prompt: color};
		const rows = createMarkdownRenderer(8, palette)('**abcdefghijklmno**');
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row).toContain('\x1b[1m');
			expect(row).toContain('\x1b[22m');
			expect(row).toContain(color.startsWith('#') ? '\x1b[38;2;' : '\x1b[38;5;109m');
			expect(stripVTControlCharacters(row).length).toBeLessThanOrEqual(8);
		}
	});
});
