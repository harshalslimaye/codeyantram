import React, {useEffect} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Picker} from '../../src/components/picker.js';
import {KeyboardProvider, useKeyboardOwner} from '../../src/keyboard/provider.js';
import {ThemeProvider} from '../../src/theme/provider.js';
import {konkanTheme} from '../../src/theme/builtins/index.js';
import {createThemeRegistry} from '../../src/theme/registry/registry.js';
import {cleanupTerminal, renderTerminal} from '../helpers/terminal-ui.js';

const registry = createThemeRegistry([{source: 'builtin', themes: [{source: 'builtin', theme: konkanTheme}]}]);
afterEach(cleanupTerminal);

function setup(filterable = true, isDisabled = false) {
	const onSelect = vi.fn<(value: string) => void>();
	const onCancel = vi.fn<() => void>();
	function OpenPicker() {
		const {push} = useKeyboardOwner();
		useEffect(() => {push('model-picker');}, [push]);
		return <Picker owner="model-picker" title="Models" filterable={filterable} isDisabled={isDisabled}
			options={[{value: 'alpha-id', label: 'First model'}, {value: 'beta-id', label: 'Second model'}]}
			onSelect={onSelect} onCancel={onCancel} />;
	}
	const ui = renderTerminal(<ThemeProvider registry={registry} initialThemeId="konkan" colorDepth={0}>
		<KeyboardProvider><OpenPicker /></KeyboardProvider>
	</ThemeProvider>);
	return {...ui, onSelect, onCancel};
}

describe('picker filter', () => {
	it('is opt-in', async () => {
		const ui = setup(false);
		await vi.waitFor(() => expect(ui.frame()).toContain('First model'));
		expect(ui.frame()).not.toContain('Filter:');
	});

	it('matches values case-insensitively and selects with Enter', async () => {
		const ui = setup();
		await vi.waitFor(() => expect(ui.frame()).toContain('Filter:'));
		ui.stdin.write('BETA');
		await vi.waitFor(() => {
			expect(ui.frame()).toContain('Second model');
			expect(ui.frame()).not.toContain('First model');
		});
		expect(ui.onSelect).not.toHaveBeenCalled();
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.onSelect).toHaveBeenCalledExactlyOnceWith('beta-id'));
	});

	it('handles empty results, clearing, navigation, and cancellation', async () => {
		const ui = setup();
		await vi.waitFor(() => expect(ui.frame()).toContain('Filter:'));
		ui.stdin.write('z');
		await vi.waitFor(() => expect(ui.frame()).toContain('No matching options'));
		ui.stdin.write('\r');
		await ui.flush();
		expect(ui.onSelect).not.toHaveBeenCalled();
		ui.stdin.write('\u007f');
		await vi.waitFor(() => expect(ui.frame()).toContain('First model'));
		ui.stdin.write('\u001b[B');
		await ui.flush();
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.onSelect).toHaveBeenCalledExactlyOnceWith('beta-id'));
		ui.stdin.write('\u001b');
		await vi.waitFor(() => expect(ui.onCancel).toHaveBeenCalledOnce());
	});

	it('ignores typing and selection while disabled', async () => {
		const ui = setup(true, true);
		await vi.waitFor(() => expect(ui.frame()).toContain('Filter:'));
		ui.stdin.write('beta\r');
		await ui.flush();
		expect(ui.frame()).toContain('First model');
		expect(ui.onSelect).not.toHaveBeenCalled();
	});
});
