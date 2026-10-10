import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {Box, Text, measureElement, useWindowSize, type DOMElement} from 'ink';
import wrapAnsi from 'wrap-ansi';
import type {ChatMessage, ToolInput, ToolResult} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';
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
	if (result.toolName !== 'web_fetch' || result.output === null || typeof result.output !== 'object' || Array.isArray(result.output)) return 'completed';
	const details = ['completed'];
	const {warnings, truncation, filtering} = result.output;
	if (filtering !== null && typeof filtering === 'object' && !Array.isArray(filtering) && filtering.status === 'completed') details.push('JEV filtered');
	if (truncation !== null && typeof truncation === 'object' && !Array.isArray(truncation) && truncation.truncated === true) details.push('output truncated');
	if (Array.isArray(warnings)) details.push(...warnings.filter((warning): warning is string => typeof warning === 'string').map(warning => warning.slice(0, MAX_WARNING_CHARACTERS)));
	return details.join(' · ');
}

export function Conversation({messages, statusEntries, isStreaming}: {messages: ChatMessage[]; statusEntries: StatusEntry[]; isStreaming: boolean}) {
	const {palette} = useTheme();
	const {isOwner} = useKeyboardOwner();
	const {columns, rows} = useWindowSize();
	const viewport = useRef<DOMElement>(null);
	const [height, setHeight] = useState(Math.max(1, rows - RESERVED_TERMINAL_ROWS));
	const [blockHeights, setBlockHeights] = useState<Record<string, number>>({});
	const measureBlock = useCallback((id: string, measuredHeight: number) => {
		setBlockHeights(previous => previous[id] === measuredHeight ? previous : {...previous, [id]: measuredHeight});
	}, []);
	// null follows the newest output; a fixed end preserves the reading position
	// when more text arrives while the user is looking at earlier lines.
	const [end, setEnd] = useState<number | null>(null);
	const renderMessage = useMemo(() => {
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
	}, [columns, palette]);
	const messageLines = useMemo(() => messages.map((message, index) => {
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
	}), [messages, isStreaming, renderMessage]);
	const blocks = useMemo(() => {
		const welcomeHeight = blockHeights.welcome ?? 0;
		const result: ConversationBlock[] = [{id: 'welcome', start: 0, height: welcomeHeight}];
		let start = welcomeHeight;
		let entryIndex = 0;
		for (let index = 0; index <= messages.length; index++) {
			while (statusEntries[entryIndex]?.afterMessageCount === index) {
				const entry = statusEntries[entryIndex++];
				const blockHeight = blockHeights[entry.id] ?? 0;
				result.push({id: entry.id, start, height: blockHeight, status: entry});
				start += blockHeight;
			}
			if (index < messages.length) {
				const lines = messageLines[index];
				result.push({id: messages[index].id, start, height: lines.length, lines});
				start += lines.length;
			}
		}
		return result;
	}, [messages, messageLines, statusEntries, blockHeights]);
	const totalLines = blocks.reduce((total, block) => total + block.height, 0);
	useEffect(() => {
		if (viewport.current) setHeight(Math.max(1, Math.floor(measureElement(viewport.current).height)));
	});
	useEffect(() => {setEnd(null);}, [messages.length, statusEntries.length]);
	useEffect(() => {
		const ids = new Set(['welcome', ...statusEntries.map(entry => entry.id)]);
		setBlockHeights(previous => Object.keys(previous).some(id => !ids.has(id))
			? Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id))) : previous);
	}, [statusEntries]);
	useMouseWheel(event => {
		if (!isOwner('input-bar') || !viewport.current) return;
		const bounds = measureElement(viewport.current);
		// SGR coordinates are one-based; footer and picker scrolling must not move chat.
		if (event.x <= bounds.x || event.x > bounds.x + bounds.width || event.y <= bounds.y || event.y > bounds.y + bounds.height) return;
		setEnd(previous => {
			const current = Math.min(totalLines, previous ?? totalLines);
			const next = Math.max(Math.min(height, totalLines), Math.min(totalLines, current + (event.direction === 'up' ? NEGATIVE_SCROLL_LINES : SCROLL_LINES)));
			return next === totalLines ? null : next;
		});
	});
	const visibleEnd = Math.max(Math.min(height, totalLines), Math.min(totalLines, end ?? totalLines));
	const visibleStart = Math.max(0, visibleEnd - height);

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
