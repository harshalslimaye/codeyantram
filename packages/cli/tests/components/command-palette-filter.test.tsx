import React, {useEffect} from 'react';
import {Text} from 'ink';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {CommandPalette} from '../../src/components/command-palette.js';
import {InputBar} from '../../src/components/input-bar.js';
import {KeyboardProvider, useKeyboardOwner} from '../../src/keyboard/provider.js';
import {ThemeProvider} from '../../src/theme/provider.js';
import {konkanTheme} from '../../src/theme/builtins/index.js';
import {createThemeRegistry} from '../../src/theme/registry/registry.js';
import {cleanupTerminal, renderTerminal} from '../helpers/terminal-ui.js';

const registry = createThemeRegistry([{source: 'builtin', themes: [{source: 'builtin', theme: konkanTheme}]}]);
afterEach(cleanupTerminal);

function setup(query?: string) {
	const onSelect = vi.fn<(command: string) => void>();
	function OpenPalette() {
		const {push, owner} = useKeyboardOwner();
		useEffect(() => {push('command-palette');}, [push]);
		return <><Text>Owner: {owner}</Text><CommandPalette query={query} onSelect={onSelect} /></>;
	}
	const ui = renderTerminal(<ThemeProvider registry={registry} initialThemeId="konkan" colorDepth={0}>
		<KeyboardProvider><OpenPalette /></KeyboardProvider>
	</ThemeProvider>);
	return {...ui, onSelect};
}

describe('command palette filter', () => {
	it('closes with Escape in the input bar and resumes normal typing', async () => {
		const onSubmit = vi.fn<(text: string) => void>();
		const ui = renderTerminal(<ThemeProvider registry={registry} initialThemeId="konkan" colorDepth={0}>
			<KeyboardProvider><InputBar modelPreferences={{modelId: 'gpt-6.1-sol', effortByModel: {}}}
				onSelectModel={async () => {}} operation="idle" onSubmit={onSubmit}
				onCancel={() => {}} onClear={() => {}} onCompact={() => {}} onStatus={() => {}} onInit={() => {}} />
			</KeyboardProvider>
		</ThemeProvider>);
		await ui.flush();
		ui.stdin.write('/');
		await vi.waitFor(() => expect(ui.frame()).toContain('Filter:'));
		ui.stdin.write('summarize');
		await vi.waitFor(() => expect(ui.frame()).toContain('Filter: summarize'));
		ui.stdin.write('\u001b');
		await vi.waitFor(() => expect(ui.frame()).not.toContain('Filter:'));
		ui.stdin.write('\u007f');
		await ui.flush();
		ui.stdin.write('hello');
		await ui.flush();
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('hello'));
	});

	it('matches command prefixes case-insensitively and selects once', async () => {
		const ui = setup();
		await vi.waitFor(() => expect(ui.frame()).toContain('Filter:'));
		ui.stdin.write('COM');
		await vi.waitFor(() => {
			expect(ui.frame()).toContain('/compact');
			expect(ui.frame()).not.toContain('/help');
		});
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.onSelect).toHaveBeenCalledExactlyOnceWith('/compact'));
		await vi.waitFor(() => {
			expect(ui.frame()).toContain('Owner: input-bar');
			expect(ui.frame()).not.toContain('Filter:');
		});
	});

	it.each(['omp', 'summarize'])('does not match substrings or descriptions: %s', async query => {
		const ui = setup(query);
		await vi.waitFor(() => expect(ui.frame()).toContain('No matching options'));
		ui.stdin.write('\r');
		await ui.flush();
		expect(ui.onSelect).not.toHaveBeenCalled();
	});

	it('accepts a leading slash and does not match description words', async () => {
		const ui = setup('/MOD');
		await vi.waitFor(() => {
			expect(ui.frame()).toContain('/model');
			expect(ui.frame()).not.toContain('/status');
		});
	});

	it('seeds the query, clears it, ignores empty selection, and closes on Escape', async () => {
		const ui = setup('theme');
		await vi.waitFor(() => {
			expect(ui.frame()).toContain('/theme');
			expect(ui.frame()).not.toContain('/help');
		});
		for (let i = 0; i < 5; i++) {
			ui.stdin.write('\u007f');
			await ui.flush();
		}
		await vi.waitFor(() => expect(ui.frame()).toContain('/help'));
		ui.stdin.write('zzzz');
		await vi.waitFor(() => expect(ui.frame()).toContain('No matching options'));
		ui.stdin.write('\r');
		await ui.flush();
		expect(ui.onSelect).not.toHaveBeenCalled();
		ui.stdin.write('\u001b');
		await vi.waitFor(() => {
			expect(ui.frame()).toContain('Owner: input-bar');
			expect(ui.frame()).not.toContain('Filter:');
		});
	});
});
