import React, {useCallback, useMemo, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Select, Spinner} from '@inkjs/ui';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';

export function ThemePicker() {
	const [attempt, setAttempt] = useState(0);
	const [isSaving, setIsSaving] = useState(false);
	const saving = useRef(false);
	const {palette, themes, selectedId, selectTheme, setNotice} = useTheme();
	const {owner, isOwner, pop} = useKeyboardOwner();
	const options = useMemo(() => [...themes]
		.sort((left, right) => Number(right.theme.id === selectedId) - Number(left.theme.id === selectedId))
		.map(entry => ({
			value: entry.theme.id,
			label: `${entry.theme.name.padEnd(18)}${entry.theme.id === selectedId ? 'active' : entry.source}`,
		})), [themes, selectedId]);

	async function saveTheme(id: string) {
		if (saving.current || !isOwner('theme-picker')) return;
		saving.current = true;
		setIsSaving(true);
		try {
			await selectTheme(id);
			pop('theme-picker');
		} catch (error) {
			setNotice(`Could not save theme: ${String(error)}`, 'error');
			// Select reports value changes, so remount it to allow retrying the same theme.
			setAttempt(previous => previous + 1);
		} finally {
			saving.current = false;
			setIsSaving(false);
		}
	}

	const saveThemeRef = useRef(saveTheme);
	saveThemeRef.current = saveTheme;
	// Select runs onChange in an effect; keep its identity stable across parent renders.
	const handleChange = useCallback((id: string) => {
		void saveThemeRef.current(id);
	}, []);

	useInput((_input, key) => {
		if (isOwner('theme-picker') && !saving.current && key.escape) pop('theme-picker');
	}, {isActive: owner === 'theme-picker'});

	return (
		<>
			<Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
				<Text color={palette.muted}>Choose a theme · saved to user config</Text>
				<Select key={attempt} options={options} isDisabled={isSaving || owner !== 'theme-picker'} onChange={handleChange} />
			</Box>
			{isSaving && <Spinner label="Saving theme…" />}
		</>
	);
}
