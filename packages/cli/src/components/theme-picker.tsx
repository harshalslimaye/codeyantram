import React, {useMemo, useRef, useState} from 'react';
import {Spinner} from '@inkjs/ui';
import {Picker} from './picker.js';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';

export function ThemePicker() {
	const [attempt, setAttempt] = useState(0);
	const [isSaving, setIsSaving] = useState(false);
	const saving = useRef(false);
	const {themes, selectedId, selectTheme, setNotice} = useTheme();
	const {isOwner, pop} = useKeyboardOwner();
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

	return (
		<>
			<Picker
				owner="theme-picker"
				title="Choose a theme · saved to user config"
				options={options}
				isDisabled={isSaving}
				resetKey={attempt}
				onSelect={id => { void saveTheme(id); }}
				onCancel={() => { if (!saving.current) pop('theme-picker'); }}
			/>
			{isSaving && <Spinner label="Saving theme…" />}
		</>
	);
}
