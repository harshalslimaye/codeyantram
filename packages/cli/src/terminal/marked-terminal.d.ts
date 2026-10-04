declare module 'marked-terminal' {
	type Style = (text: string) => string;
	interface TerminalOptions {
		code?: Style;
		blockquote?: Style;
		html?: Style;
		heading?: Style;
		firstHeading?: Style;
		hr?: Style;
		listitem?: Style;
		table?: Style;
		paragraph?: Style;
		strong?: Style;
		em?: Style;
		codespan?: Style;
		del?: Style;
		link?: Style;
		href?: Style;
		text?: Style;
		emoji?: boolean;
		width?: number;
		showSectionPrefix?: boolean;
		reflowText?: boolean;
		tab?: number;
		tableOptions?: {
			colWidths?: number[];
			wordWrap?: boolean;
			style?: {head?: string[]; border?: string[]};
		};
	}
	export function markedTerminal(options?: TerminalOptions, highlightOptions?: {
		theme?: Record<string, Style>;
	}): import('marked').MarkedExtension;
}
