import React, { useCallback } from 'react';
import {Picker} from './picker.js';
import { useKeyboardOwner } from '../keyboard/provider.js';
import { getCommandOptions } from '../lib/commands.js';

function matchesCommand(option: {value: string}, query: string) {
	return option.value.slice(1).toLowerCase().startsWith(query.replace(/^\//, ''));
}

type CommandPaletteProps = {query?: string; onSelect: (command: string) => void; onQueryChange?: (query: string) => void};

export function CommandPalette({query, onSelect, onQueryChange}: CommandPaletteProps) {
	const { owner } = useKeyboardOwner();
	return owner === 'command-palette' ? <CommandPaletteRenderer query={query} onSelect={onSelect} onQueryChange={onQueryChange} /> : null;
}

function CommandPaletteRenderer({query, onSelect, onQueryChange}: CommandPaletteProps) {
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
			options={options} filterable initialQuery={query ?? ''} filterOption={matchesCommand}
			onQueryChange={onQueryChange}
			onSelect={handleChange} onCancel={() => pop('command-palette')} />
	);
}
