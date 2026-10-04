import React, {useEffect, useRef, useState, useMemo} from 'react';
import {Box, Text, measureElement, useWindowSize, type DOMElement} from 'ink';
import wrapAnsi from 'wrap-ansi';
import type {ChatMessage} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useMouseWheel} from '../terminal/mouse.js';
import {createMarkdownRenderer} from '../terminal/markdown.js';

export function Conversation({messages, isStreaming}: {messages: ChatMessage[]; isStreaming: boolean}) {
	const {palette} = useTheme();
	const {isOwner} = useKeyboardOwner();
	const {columns, rows} = useWindowSize();
	const viewport = useRef<DOMElement>(null);
	const [height, setHeight] = useState(Math.max(1, rows - 5));
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
	const lines = useMemo(() => messages.flatMap((message, index) => {
		const pending = isStreaming && index === messages.length - 1 && message.role === 'assistant';
		if (!message.parts.length && !pending) return [];
		const text = message.parts.map(part => part.text).join('') || (pending ? 'Waiting for response…' : '');
		return [
			{kind: message.role, text: message.role === 'user' ? 'You' : 'Assistant'},
			...renderMessage(message, text).map(text => ({kind: 'text', text})),
			{kind: 'text', text: ''},
		];
	}), [messages, isStreaming, renderMessage]);
	useEffect(() => {
		if (viewport.current) setHeight(Math.max(1, Math.floor(measureElement(viewport.current).height)));
	});
	useEffect(() => {setEnd(null);}, [messages.length]);
	useMouseWheel(event => {
		if (!isOwner('input-bar') || !viewport.current) return;
		const bounds = measureElement(viewport.current);
		// SGR coordinates are one-based; footer and picker scrolling must not move chat.
		if (event.x <= bounds.x || event.x > bounds.x + bounds.width || event.y <= bounds.y || event.y > bounds.y + bounds.height) return;
		setEnd(previous => {
			const current = Math.min(lines.length, previous ?? lines.length);
			const next = Math.max(Math.min(height, lines.length), Math.min(lines.length, current + (event.direction === 'up' ? -3 : 3)));
			return next === lines.length ? null : next;
		});
	});
	const visibleEnd = Math.max(Math.min(height, lines.length), Math.min(lines.length, end ?? lines.length));
	const visibleLines = lines.slice(Math.max(0, visibleEnd - height), visibleEnd);

	return (
		<Box ref={viewport} flexGrow={1} flexShrink={1} flexBasis={0} overflowY="hidden" paddingX={1} flexDirection="column">
			{messages.length === 0 ? (
				<Text color={palette.muted}>Type a message and press Enter. Use /connect to add an API key.</Text>
			) : visibleLines.map((line, index) => (
				<Text key={index} color={line.kind === 'user' ? palette.prompt : line.kind === 'assistant' ? palette.primary : palette.text}>
					{line.text || ' '}
				</Text>
			))}
		</Box>
	);
}
