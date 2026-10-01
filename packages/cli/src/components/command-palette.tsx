import React, { useCallback } from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import { useTheme } from '../theme/provider.js';
import { useKeyboardOwner } from '../keyboard/provider.js';
import { getCommandOptions } from '../lib/commands.js';


export function CommandPalette({query, onSelect}: {query?: string, onSelect: (command: string) => void}) {
	const { owner } = useKeyboardOwner();
	return owner === 'command-palette' ? <CommandPaletteRenderer query={query} onSelect={onSelect} /> : null;
}

function CommandPaletteRenderer({query, onSelect}: {query?: string, onSelect: (command: string) => void}) {
	const { palette } = useTheme();
	const { isOwner, pop } = useKeyboardOwner();
	const options = getCommandOptions(query ?? '');

	// Select calls onChange from an effect; parent renders must not repeat selection.
	const handleChange = useCallback((command: string) => {
		if (!isOwner('command-palette')) return;
		pop('command-palette');
		onSelect(command);
	}, [isOwner, pop, onSelect]);

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
			<Text color={palette.muted}>Commands · ↑/↓ navigate · Enter select · Esc close</Text>
			<Select options={options} onChange={handleChange} />
		</Box>
	);
}
