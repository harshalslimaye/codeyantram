import React, {useCallback, useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import {Select} from '@inkjs/ui';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner, type KeyboardOwner} from '../keyboard/provider.js';

type PickerProps<Value extends string> = {
	owner: Exclude<KeyboardOwner, 'input-bar'>;
	title: string;
	options: {value: Value; label: string}[];
	isDisabled?: boolean;
	resetKey?: number;
	onSelect: (value: Value) => void;
	onCancel: () => void;
};

export function Picker<Value extends string>({
	owner: pickerOwner,
	title,
	options,
	isDisabled = false,
	resetKey,
	onSelect,
	onCancel,
}: PickerProps<Value>) {
	const {palette} = useTheme();
	const {owner, isOwner} = useKeyboardOwner();
	const interaction = useRef({pickerOwner, isOwner, isDisabled, options, onSelect, onCancel});
	interaction.current = {pickerOwner, isOwner, isDisabled, options, onSelect, onCancel};

	// Select calls onChange in an effect; a stable callback prevents repeat selections.
	const handleChange = useCallback((value: string) => {
		const current = interaction.current;
		if (!current.isOwner(current.pickerOwner) || current.isDisabled) return;
		const option = current.options.find(option => option.value === value);
		if (option) current.onSelect(option.value);
	}, []);

	useInput((_input, key) => {
		const current = interaction.current;
		if (key.escape && current.isOwner(current.pickerOwner) && !current.isDisabled) current.onCancel();
	}, {isActive: owner === pickerOwner});

	if (owner !== pickerOwner) return null;

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
			<Text color={palette.muted}>{title}</Text>
			<Select key={resetKey} options={options} isDisabled={isDisabled} onChange={handleChange} />
		</Box>
	);
}
