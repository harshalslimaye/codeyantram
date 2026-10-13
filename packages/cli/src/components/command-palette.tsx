import React, { useCallback } from 'react';
import {Picker} from './picker.js';
import { useKeyboardOwner } from '../keyboard/provider.js';
import { getCommandOptions } from '../lib/commands.js';


export function CommandPalette({query, onSelect}: {query?: string, onSelect: (command: string) => void}) {
	const { owner } = useKeyboardOwner();
	return owner === 'command-palette' ? <CommandPaletteRenderer query={query} onSelect={onSelect} /> : null;
}

function CommandPaletteRenderer({query, onSelect}: {query?: string, onSelect: (command: string) => void}) {
	const { isOwner, pop } = useKeyboardOwner();
	const options = getCommandOptions();

	// Select calls onChange from an effect; parent renders must not repeat selection.
	const handleChange = useCallback((command: string) => {
		if (!isOwner('command-palette')) return;
		pop('command-palette');
		onSelect(command);
	}, [isOwner, pop, onSelect]);

	return (
		<Picker owner="command-palette"
			title="Commands · ↑/↓ navigate · Enter select · Esc close"
			options={options} filterable initialQuery={query ?? ''}
			onSelect={handleChange} onCancel={() => pop('command-palette')} />
	);
}
