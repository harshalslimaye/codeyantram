import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {Box, Text, measureElement, useWindowSize, type DOMElement} from 'ink';
import wrapAnsi from 'wrap-ansi';
import type {ChatMessage} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useMouseWheel} from '../terminal/mouse.js';
import {createMarkdownRenderer} from '../terminal/markdown.js';
import {Welcome} from './welcome.js';
import {SessionStatus} from './session-status.js';
import {ScrollBlock} from './scroll-block.js';
import type {StatusEntry} from '../chat/session.js';

type ConversationLine = {kind: string; text: string};
type ConversationBlock = {id: string; start: number; height: number; lines?: ConversationLine[]; status?: StatusEntry};

export function Conversation({messages, statusEntries, isStreaming}: {messages: ChatMessage[]; statusEntries: StatusEntry[]; isStreaming: boolean}) {
	const {palette} = useTheme();
	const {isOwner} = useKeyboardOwner();
	const {columns, rows} = useWindowSize();
	const viewport = useRef<DOMElement>(null);
	const [height, setHeight] = useState(Math.max(1, rows - 5));
	const [blockHeights, setBlockHeights] = useState<Record<string, number>>({});
	const measureBlock = useCallback((id: string, height: number) => {
		setBlockHeights(previous => previous[id] === height ? previous : {...previous, [id]: height});
	}, []);
	// null follows the newest output; a fixed end preserves the reading position
	// when more text arrives while the user is looking at earlier lines.
	const [end, setEnd] = useState<number | null>(null);
	const renderMessage = useMemo(() => {
		const width = Math.max(1, columns - 2);
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
			if (part.type === 'tool-call') return `\nTool ${part.call.toolName} · ${JSON.stringify(part.call.input).slice(0, 160)}\n`;
			return `\n${part.result.toolName} · ${part.result.status === 'error' ? part.result.error.message : 'completed'}\n`;
		}).join('') || (pending ? 'Waiting for response…' : '');
		return [
			{kind: message.role, text: message.role === 'user' ? 'You' : 'Assistant'},
			...renderMessage(message, text).map(text => ({kind: 'text', text})),
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
				const entry = statusEntries[entryIndex++]!;
				const height = blockHeights[entry.id] ?? 0;
				result.push({id: entry.id, start, height, status: entry});
				start += height;
			}
			if (index < messages.length) {
				const lines = messageLines[index]!;
				result.push({id: messages[index]!.id, start, height: lines.length, lines});
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
			const next = Math.max(Math.min(height, totalLines), Math.min(totalLines, current + (event.direction === 'up' ? -3 : 3)));
			return next === totalLines ? null : next;
		});
	});
	const visibleEnd = Math.max(Math.min(height, totalLines), Math.min(totalLines, end ?? totalLines));
	const visibleStart = Math.max(0, visibleEnd - height);

	return (
		<Box ref={viewport} flexGrow={1} flexShrink={1} flexBasis={0} overflowY="hidden" paddingX={1} flexDirection="column">
			{blocks.map(block => block.lines ? block.lines
				.slice(Math.max(0, visibleStart - block.start), Math.max(0, visibleEnd - block.start))
				.map((line, index) => (
					<Text key={`${block.id}-${index}`} color={line.kind === 'user' ? palette.prompt : line.kind === 'assistant' ? palette.primary : palette.text}>
						{line.text || ' '}
					</Text>
				)) : (
				<ScrollBlock key={block.id} id={block.id} start={block.start} height={block.height} visibleStart={visibleStart} visibleEnd={visibleEnd} onMeasure={measureBlock}>
					{block.status ? <SessionStatus status={block.status.status} /> : <Welcome width={Math.max(1, columns - 2)} />}
				</ScrollBlock>
			))}
		</Box>
	);
}
