import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {Box, Text, measureElement, useWindowSize, type DOMElement} from 'ink';
import wrapAnsi from 'wrap-ansi';
import type {ChatMessage, ToolInput, ToolResult} from '@codeyantram/shared';
import {useTheme, type InkThemePalette} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useMouseWheel} from '../terminal/mouse.js';
import {createMarkdownRenderer} from '../terminal/markdown.js';
import {Welcome} from './welcome.js';
import {SessionStatus} from './session-status.js';
import {ScrollBlock} from './scroll-block.js';
import type {StatusEntry} from '../chat/session.js';

const CONVERSATION_HORIZONTAL_MARGIN = 2;

const MAX_TOOL_SUMMARY_CHARACTERS = 160;
const MAX_WARNING_CHARACTERS = 240;
const RESERVED_TERMINAL_ROWS = 5;
const NEGATIVE_SCROLL_LINES = -3;
const SCROLL_LINES = 3;

type ConversationLine = {kind: string; text: string};
type ConversationBlock = {id: string; start: number; height: number; lines?: ConversationLine[]; status?: StatusEntry};

function toolInputSummary(input: ToolInput): string {
	const reference = input.reference;
	const filePath = reference !== null && typeof reference === 'object' && !Array.isArray(reference) ? reference.filePath : input.filePath;
	let target: string;
	if (typeof input.url === 'string') target = input.url;
	else if (typeof input.query === 'string') target = input.query;
	else if (typeof filePath === 'string') target = filePath;
	else target = JSON.stringify(input);
	return [target, typeof input.direction === 'string' ? input.direction : ''].filter(Boolean).join(' · ').slice(0, MAX_TOOL_SUMMARY_CHARACTERS);
}

function toolResultSummary(result: ToolResult): string {
	if (result.status === 'error') return result.error.message;
	if (result.toolName !== 'web_fetch' || !isDetailsRecord(result.output)) return 'completed';
	const details = ['completed'];
	const {warnings, truncation, filtering} = result.output;
	if (isDetailsRecord(filtering) && filtering.status === 'completed') details.push('JEV filtered');
	if (isDetailsRecord(truncation) && truncation.truncated === true) details.push('output truncated');
	if (Array.isArray(warnings)) details.push(...warnings.filter((warning): warning is string => typeof warning === 'string').map(warning => warning.slice(0, MAX_WARNING_CHARACTERS)));
	return details.join(' · ');
}

export function Conversation({messages, statusEntries, isStreaming}: {messages: ChatMessage[]; statusEntries: StatusEntry[]; isStreaming: boolean}) {
	const {palette} = useTheme();
	const {isOwner} = useKeyboardOwner();
	const {columns, rows} = useWindowSize();
	const {blocks, totalLines, measureBlock} = useConversationContent(messages, statusEntries, {isStreaming, columns, palette});
	const {viewport, visibleStart, visibleEnd} = useConversationViewport(messages.length, statusEntries.length, {rows, totalLines, isOwner});

	return (
		<Box ref={viewport} flexGrow={1} flexShrink={1} flexBasis={0} overflowY="hidden" paddingX={1} flexDirection="column">
			{blocks.map(block => block.lines ? block.lines
				.slice(Math.max(0, visibleStart - block.start), Math.max(0, visibleEnd - block.start))
				.map((line, index) => {
					let color: string | undefined;
					if (line.kind === 'user') color = palette.prompt;
					else if (line.kind === 'assistant') color = palette.primary;
					else color = palette.text;
					return <Text key={`${block.id}-${index}`} color={color}>
						{line.text || ' '}
					</Text>;
				}) : (
				<ScrollBlock key={block.id} id={block.id} start={block.start} height={block.height} visibleStart={visibleStart} visibleEnd={visibleEnd} onMeasure={measureBlock}>
					{block.status ? <SessionStatus status={block.status.status} /> : <Welcome width={Math.max(1, columns - CONVERSATION_HORIZONTAL_MARGIN)} />}
				</ScrollBlock>
			))}
		</Box>
	);
}

function createMessageRenderer(columns: number, palette: InkThemePalette) {
	const width = Math.max(1, columns - CONVERSATION_HORIZONTAL_MARGIN);
	const renderMarkdown = createMarkdownRenderer(width, palette);
	const cache = new WeakMap<ChatMessage, string[]>();
	return (message: ChatMessage, text: string) => {
		const cached = cache.get(message);
		if (cached) return cached;
		const lines = message.role === 'assistant' ? renderMarkdown(text) : wrapAnsi(text, width, {hard: true}).split('\n');
		cache.set(message, lines);
		return lines;
	};
}

function buildMessageLines(messages: ChatMessage[], isStreaming: boolean, renderMessage: ReturnType<typeof createMessageRenderer>): ConversationLine[][] {
	return messages.map((message, index) => {
		const pending = isStreaming && index === messages.length - 1 && message.role === 'assistant';
		if (!message.parts.length && !pending) return [];
		const text = message.parts.map(part => {
			if (part.type === 'text') return part.text;
			if (part.type === 'tool-call') return `\nTool ${part.call.toolName} · ${toolInputSummary(part.call.input)}\n`;
			return `\n${part.result.toolName} · ${toolResultSummary(part.result)}\n`;
		}).join('') || (pending ? 'Waiting for response…' : '');
		return [
			{kind: message.role, text: message.role === 'user' ? 'You' : 'Assistant'},
			...renderMessage(message, text).map(lineText => ({kind: 'text', text: lineText})),
			{kind: 'text', text: ''},
		];
	});
}

function buildBlocks(context: {messages: ChatMessage[]; messageLines: ConversationLine[][]; statusEntries: StatusEntry[]; blockHeights: Record<string, number>}): ConversationBlock[] {
	const {messages, messageLines, statusEntries, blockHeights} = context;
		const welcomeHeight = blockHeights.welcome ?? 0;
		const result: ConversationBlock[] = [{id: 'welcome', start: 0, height: welcomeHeight}];
		let start = welcomeHeight;
		let entryIndex = 0;
		for (let index = 0; index <= messages.length; index++) {
			while (statusEntries[entryIndex]?.afterMessageCount === index) { // oxlint-disable-line security/detect-object-injection -- Keys are transcript/status IDs or array positions bounded by their respective collections.
				const entry = statusEntries[entryIndex++];
				const blockHeight = blockHeights[entry.id] ?? 0;
				result.push({id: entry.id, start, height: blockHeight, status: entry});
				start += blockHeight;
			}
			if (index < messages.length) {
				const lines = messageLines[index]; // oxlint-disable-line security/detect-object-injection -- Keys are transcript/status IDs or array positions bounded by their respective collections.
				result.push({id: messages[index].id, start, height: lines.length, lines}); // oxlint-disable-line security/detect-object-injection -- Keys are transcript/status IDs or array positions bounded by their respective collections.
				start += lines.length;
			}
		}
		return result;
}

function useConversationContent(messages: ChatMessage[], statusEntries: StatusEntry[], options: {isStreaming: boolean; columns: number; palette: InkThemePalette}) {
	const {isStreaming, columns, palette} = options;
	const [blockHeights, setBlockHeights] = useState<Record<string, number>>({});
	const activeIds = useMemo(() => new Set(['welcome', ...statusEntries.map(entry => entry.id)]), [statusEntries]);
	const measureBlock = useCallback((id: string, measuredHeight: number) => {
		setBlockHeights(previous => updateBlockMeasurement(previous, activeIds, id, measuredHeight));
	}, [activeIds]);
	const renderMessage = useMemo(() => createMessageRenderer(columns, palette), [columns, palette]);
	const messageLines = useMemo(() => buildMessageLines(messages, isStreaming, renderMessage), [messages, isStreaming, renderMessage]);
	const blocks = useMemo(() => buildBlocks({messages, messageLines, statusEntries, blockHeights}), [messages, messageLines, statusEntries, blockHeights]);
	const totalLines = blocks.reduce((total, block) => total + block.height, 0);
	return {blocks, totalLines, measureBlock};
}

function useConversationViewport(messageCount: number, statusCount: number, options: {rows: number; totalLines: number; isOwner: ReturnType<typeof useKeyboardOwner>['isOwner']}) {
	const {rows, totalLines, isOwner} = options;
	const viewport = useRef<DOMElement>(null);
	const [height, setHeight] = useState(Math.max(1, rows - RESERVED_TERMINAL_ROWS));
	// null follows the newest output; a fixed end preserves the reading position
	// when more text arrives while the user is looking at earlier lines.
	const [scroll, setScroll] = useState<{end: number | null; messageCount: number; statusCount: number}>({end: null, messageCount, statusCount});
	const countsChanged = scroll.messageCount !== messageCount || scroll.statusCount !== statusCount;
	if (countsChanged) setScroll({end: null, messageCount, statusCount});
	const end = countsChanged ? null : scroll.end;
	// oxlint-disable-next-line react-hooks/exhaustive-deps -- Measure external Ink geometry after every commit, including footer and picker layout changes.
	useEffect(() => {
		if (viewport.current) setHeight(Math.max(1, Math.floor(measureElement(viewport.current).height)));
	});
	useMouseWheel(event => {
		if (!isOwner('input-bar') || !viewport.current) return;
		const bounds = measureElement(viewport.current);
		// SGR coordinates are one-based; footer and picker scrolling must not move chat.
		if (event.x <= bounds.x || event.x > bounds.x + bounds.width || event.y <= bounds.y || event.y > bounds.y + bounds.height) return;
		setScroll(previous => {
			const current = Math.min(totalLines, previous.end ?? totalLines);
			const next = Math.max(Math.min(height, totalLines), Math.min(totalLines, current + (event.direction === 'up' ? NEGATIVE_SCROLL_LINES : SCROLL_LINES)));
			return {...previous, end: next === totalLines ? null : next};
		});
	});
	const visibleEnd = Math.max(Math.min(height, totalLines), Math.min(totalLines, end ?? totalLines));
	const visibleStart = Math.max(0, visibleEnd - height);

	return {viewport, visibleStart, visibleEnd};
}

function isDetailsRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function updateBlockMeasurement(previous: Record<string, number>, activeIds: Set<string>, id: string, measuredHeight: number): Record<string, number> {
	const retained = Object.fromEntries(Object.entries(previous).filter(([key]) => activeIds.has(key)));
	if (retained[id] === measuredHeight && Object.keys(retained).length === Object.keys(previous).length) return previous; // oxlint-disable-line security/detect-object-injection -- Measurement IDs come from the rendered status blocks.
	return {...retained, [id]: measuredHeight};
}
