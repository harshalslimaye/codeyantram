import {Chalk, type ChalkInstance} from 'chalk';
import {Marked, type Renderer, type Tokens} from 'marked';
import {markedTerminal} from 'marked-terminal';
import wrapAnsi from 'wrap-ansi';
import type {InkThemePalette} from '../theme/provider.js';

const INDEXED_COLOR_LEVEL = 2;
const TABLE_CELL_PADDING = 2;

const TRUE_COLOR_LEVEL = 3;
const MIN_TABLE_CELL_WIDTH = 5;

/** Render the accumulated source before wrapping, so Markdown can span stream chunks. */
export function createMarkdownRenderer(columns: number, palette: InkThemePalette): (source: string) => string[] {
	const width = Math.max(1, columns);
	const {chalk, text, primary, muted, code, highlightTheme} = markdownStyles(palette);
	const tableOptions = {colWidths: [] as number[], wordWrap: true, style: {head: [], border: []}};
	const terminal = markedTerminal({
		width, reflowText: false, showSectionPrefix: false, emoji: false, tab: 2,
		code, codespan: code, blockquote: muted.italic, html: muted,
		heading: primary.bold, firstHeading: primary.bold, hr: muted,
		listitem: text, table: text, paragraph: text, text,
		strong: chalk.bold, em: chalk.italic, del: muted.strikethrough,
		link: primary, href: primary.underline, tableOptions,
	}, {theme: highlightTheme});
	const renderTable = terminal.renderer?.table;
	if (!renderTable) throw new Error('Markdown table renderer is unavailable.');
	const parser = new Marked({gfm: true, breaks: true, async: false}, terminal, {
		renderer: {
			// marked-terminal's text renderer ignores nested inline tokens in lists.
			text(token) {return 'tokens' in token && token.tokens ? this.parser.parseInline(token.tokens) : text(token.text);},
			// Emoji replacement is disabled, so inline code needs no colon placeholders.
			codespan(token) {return code(token.text);},
			hr() {return muted('─'.repeat(width)) + '\n\n';},
			link(token) {
				const label = this.parser.parseInline(token.tokens);
				return label === token.href ? primary.underline(token.href) : `${label} (${primary.underline(token.href)})`;
			},
			table: tableRenderer({width, chalk, tableOptions, renderTable}),
		},
	});
	return source => {
		let rendered: string;
		try {
			rendered = parser.parse(source, {async: false});
		} catch {
			// A renderer failure must not hide a reply or interrupt generation.
			rendered = source;
		}
		return wrapAnsi(rendered.replace(/\n+$/, ''), width, {hard: true, trim: false}).split('\n');
	};
}

function tableRenderer(context: {width: number; chalk: ChalkInstance; tableOptions: {colWidths: number[]}; renderTable: NonNullable<NonNullable<ReturnType<typeof markedTerminal>['renderer']>['table']>}) {
	const {width, chalk, tableOptions, renderTable} = context;
	return function (this: Renderer, token: Tokens.Table) {
				const count = token.header.length;
				const available = width - count - 1;
				const cellWidth = Math.floor(available / count) - TABLE_CELL_PADDING;
				const longWord = [...token.header, ...token.rows.flat()].some(cell =>
					cell.text.split(/\s+/).some(word => wrapAnsi(word, Math.max(1, cellWidth), {hard: true}).includes('\n')),
				);
				if (width < count * MIN_TABLE_CELL_WIDTH + 1 || longWord) {
					// cli-table truncates words wider than a column. Stack labeled
					// cells when needed to retain the entire reply in narrow terminals.
					const headers = token.header.map(cell => this.parser.parseInline(cell.tokens));
					if (!token.rows.length) return headers.join('\n') + '\n\n';
					return token.rows.map(row => row.map((cell, index) =>
						`${chalk.bold(headers[index])}: ${this.parser.parseInline(cell.tokens)}`, // oxlint-disable-line security/detect-object-injection -- Table indices are bounded by parsed header columns.
					).join('\n')).join('\n\n') + '\n\n';
				}
				tableOptions.colWidths = Array.from({length: count}, (_, index) =>
					Math.floor(available / count) + (index < available % count ? 1 : 0),
				);
				return renderTable.call(this, token);
	};
}

function markdownStyles(palette: InkThemePalette) {
	const colors = Object.values(palette).filter((color): color is string => color !== undefined);
	let level: 0 | typeof TRUE_COLOR_LEVEL | typeof INDEXED_COLOR_LEVEL = 0;
	if (colors.some(color => color.startsWith('#'))) level = TRUE_COLOR_LEVEL;
	else if (colors.length) level = INDEXED_COLOR_LEVEL;
	const chalk = new Chalk({level});
	const style = (color: string | undefined): ChalkInstance => {
		if (color === undefined || color === '') return chalk;
		const indexed = /^ansi256\((\d+)\)$/.exec(color);
		return indexed ? chalk.ansi256(Number(indexed[1])) : chalk.hex(color);
	};
	const text = style(palette.text);
	const primary = style(palette.primary);
	const muted = style(palette.muted);
	const code = style(palette.prompt);
	// Supply every highlight token through the palette, including unknown tokens,
	// so cli-highlight cannot fall back to its own colors in monochrome mode.
	const highlightTheme = new Proxy<Record<string, (text: string) => string>>({
		keyword: primary, built_in: primary, literal: primary, number: code,
		string: style(palette.success), comment: muted, doctag: muted,
		addition: style(palette.success), deletion: style(palette.error),
	}, {get: (theme, token: string) => theme[token] ?? text}); // oxlint-disable-line security/detect-object-injection -- Highlight token names select styles in a local palette map with a text fallback.
	return {chalk, text, primary, muted, code, highlightTheme};
}
