import React, {useCallback, useMemo, useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import {Select} from '@inkjs/ui';
import type {EffortLevel, SupportedChatModelDefinition} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';

export function EffortPicker({model, preferredEffort, isSaving, onSelect}: {
	model: SupportedChatModelDefinition;
	preferredEffort?: EffortLevel;
	isSaving: boolean;
	onSelect: (effort: EffortLevel) => void;
}) {
	const {palette} = useTheme();
	const {owner, isOwner, pop} = useKeyboardOwner();
	const options = useMemo(() => [...model.supportedEffortLevels]
		.sort((left, right) => Number(right === preferredEffort) - Number(left === preferredEffort))
		.map(effort => ({
			value: effort,
			label: `${effort}${effort === preferredEffort ? ' · selected' : ''}${effort === model.defaultEffortLevel ? ' · default' : ''}`,
		})), [model, preferredEffort]);
	const selection = useRef({isOwner, isSaving, model, onSelect});
	selection.current = {isOwner, isSaving, model, onSelect};
	const handleChange = useCallback((value: string) => {
		const current = selection.current;
		if (!current.isOwner('effort-picker') || current.isSaving) return;
		const effort = current.model.supportedEffortLevels.find(level => level === value);
		if (effort !== undefined) current.onSelect(effort);
	}, []);

	useInput((_input, key) => {
		if (isOwner('effort-picker') && !isSaving && key.escape) pop('effort-picker');
	}, {isActive: owner === 'effort-picker'});

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
			<Text color={palette.muted}>Choose effort for {model.id} · ↑/↓ navigate · Enter select · Esc back</Text>
			<Select options={options} isDisabled={isSaving || owner !== 'effort-picker'} onChange={handleChange} />
		</Box>
	);
}
