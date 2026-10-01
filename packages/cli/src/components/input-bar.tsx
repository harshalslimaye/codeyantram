import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Cursor} from './cursor.js';
import {useTheme} from '../theme/provider.js';

const COMMANDS = [
	{command: '/help', description: 'Show available commands'},
	{command: '/model', description: 'Change the active model'},
	{command: '/theme', description: 'Choose a terminal theme'},
	{command: '/clear', description: 'Clear the conversation'},
	{command: '/exit', description: 'Exit Codeyantram'},
];

function CommandPalette() {
	const {palette} = useTheme();

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
			<Text color={palette.muted}>Commands</Text>
			{COMMANDS.map(item => (
				<Box key={item.command}>
					<Text color={item.command === '/clear' ? palette.warning : palette.primary} bold>{item.command.padEnd(8)}</Text>
					<Text color={palette.muted}>{item.description}</Text>
				</Box>
			))}
		</Box>
	);
}

function ThemePicker({activeIndex}: {activeIndex: number}) {
	const {palette, themes, selectedId} = useTheme();

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
			<Text color={palette.muted}>Choose a theme · saved to user config</Text>
			{themes.map((entry, index) => (
				<Box key={entry.theme.id}>
					<Text color={activeIndex === index ? palette.prompt : palette.muted}>
						{activeIndex === index ? '› ' : '  '}
					</Text>
					<Text color={entry.theme.id === selectedId ? palette.prompt : palette.text}>
						{entry.theme.name.padEnd(18)}
					</Text>
					<Text color={palette.muted}>
						{entry.theme.id === selectedId ? 'active' : entry.source}
					</Text>
				</Box>
			))}
		</Box>
	);
}

export function InputBar() {
	const [value, setValue] = useState('');
	const [activeThemeIndex, setActiveThemeIndex] = useState(0);
	const {palette, themes, selectedId, selectTheme, notice, noticeTone, setNotice} = useTheme();
	const isThemePickerOpen = value.trim().toLowerCase() === '/theme';

	useInput((input, key) => {
		if (isThemePickerOpen) {
			if (key.escape) {
				setValue('');
				return;
			}
			if (key.upArrow) {
				setActiveThemeIndex(index => (index - 1 + themes.length) % themes.length);
				return;
			}
			if (key.downArrow) {
				setActiveThemeIndex(index => (index + 1) % themes.length);
				return;
			}
			if (key.return) {
				const selectedTheme = themes[activeThemeIndex];
				if (selectedTheme) {
					void selectTheme(selectedTheme.theme.id)
						.then(() => setValue(''))
						.catch(error => setNotice(`Could not save theme: ${String(error)}`, 'error'));
				}
				return;
			}
			if (key.backspace || key.delete) {
				setValue(previousValue => previousValue.slice(0, -1));
				return;
			}
			if (input) setValue(previousValue => previousValue + input);
			return;
		}

		if (key.backspace || key.delete) {
			setValue(previousValue => previousValue.slice(0, -1));
			return;
		}

		if (key.escape) {
			setValue('');
			return;
		}

		if (value === '' && input.startsWith('/')) {
			const selectedIndex = themes.findIndex(entry => entry.theme.id === selectedId);
			setActiveThemeIndex(Math.max(0, selectedIndex));
		}
		if (input) {
			setNotice(undefined);
			setValue(previousValue => previousValue + input);
		}
	});

	return (
		<Box flexDirection="column" width="100%">
			{value === '/' && <CommandPalette />}
			{isThemePickerOpen && themes.length > 0 && <ThemePicker activeIndex={activeThemeIndex} />}
			<Box borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
				<Text color={palette.prompt}>› </Text>
				<Text color={palette.text}>{value}</Text>
				<Cursor />
			</Box>
			{notice && <Text color={palette[noticeTone]}>{notice}</Text>}
		</Box>
	);
}
