import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, measureElement, useInput, useWindowSize, type DOMElement} from 'ink';
import wrapAnsi from 'wrap-ansi';
import type {ChatMessage} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';

export function Conversation({messages, isStreaming}: {messages: ChatMessage[]; isStreaming: boolean}) {
	const {palette} = useTheme();
	const {owner, isOwner} = useKeyboardOwner();
	const {columns, rows} = useWindowSize();
	const viewport = useRef<DOMElement>(null);
	const [height, setHeight] = useState(Math.max(1, rows - 8));
	const [offset, setOffset] = useState(0);
	const lines = useMemo(() => messages.flatMap(message => {
		if (!message.parts.length && !isStreaming) return [];
		const text = message.parts.map(part => part.text).join('') || 'Waiting for response…';
		return [
			{kind: message.role, text: message.role === 'user' ? 'You' : 'Assistant'},
			...wrapAnsi(text, Math.max(1, columns - 2), {hard: true}).split('\n')
				.map(text => ({kind: 'text', text})),
			{kind: 'text', text: ''},
		];
	}), [messages, isStreaming, columns]);

	// Measure the space left by the prompt and pickers, including after resizing.
	useEffect(() => {
		if (viewport.current) setHeight(Math.max(1, Math.floor(measureElement(viewport.current).height)));
	});
	useEffect(() => {setOffset(0);}, [messages.length]);

	const maxOffset = Math.max(0, lines.length - height);
	const scrollOffset = Math.min(offset, maxOffset);
	useInput((_input, key) => {
		if (!isOwner('input-bar')) return;
		if (key.pageUp) setOffset(Math.min(maxOffset, scrollOffset + height));
		if (key.pageDown) setOffset(Math.max(0, scrollOffset - height));
	}, {isActive: owner === 'input-bar'});

	const end = Math.max(0, lines.length - scrollOffset);
	const visibleLines = lines.slice(Math.max(0, end - height), end);
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
