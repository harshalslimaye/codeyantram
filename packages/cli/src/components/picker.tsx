import React, {useCallback, useRef, useLayoutEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Select, TextInput} from '@inkjs/ui';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner, type KeyboardOwner} from '../keyboard/provider.js';

type PickerProps<Value extends string> = {
	owner: Exclude<KeyboardOwner, 'input-bar'>;
	title: string;
	options: {value: Value; label: string}[];
	isDisabled?: boolean;
	resetKey?: number;
	filterable?: boolean;
	filterPlaceholder?: string;
	initialQuery?: string;
	filterOption?: (option: {value: Value; label: string}, query: string) => boolean;
	onQueryChange?: (query: string) => void;
	onSelect: (value: Value) => void;
	onCancel: () => void;
};

export function Picker<Value extends string>(props: PickerProps<Value>) {
	const {owner} = useKeyboardOwner();
	if (props.filterable === true && owner !== props.owner) return null;
	return <ActivePicker key={String(props.filterable ?? false)} {...props} />;
}

function useFilteredOptions<Value extends string>(options: PickerProps<Value>['options'], query: string, filterable: boolean, filterOption?: PickerProps<Value>['filterOption']) {
	return useMemo(() => {
		const search = query.trim().toLowerCase();
		if (!filterable || !search) return options;
		return options.filter(option => filterOption ? filterOption(option, search) : option.label.toLowerCase().includes(search) || option.value.toLowerCase().includes(search));
	}, [options, query, filterable, filterOption]);
}

function ActivePicker<Value extends string>({
	owner: pickerOwner,
	title,
	options,
	isDisabled = false,
	resetKey,
	filterable = false,
	filterPlaceholder = 'Filter options…',
	initialQuery = '',
	filterOption,
	onQueryChange,
	onSelect,
	onCancel,
}: PickerProps<Value>) {
	const {palette} = useTheme();
	const {owner, isOwner} = useKeyboardOwner();
	const [query, setQuery] = useState(initialQuery);
	const filteredOptions = useFilteredOptions(options, query, filterable, filterOption);
	const interaction = useRef({pickerOwner, isOwner, isDisabled, options: filteredOptions, onSelect, onCancel});
	useLayoutEffect(() => {
		interaction.current = {pickerOwner, isOwner, isDisabled, options: filteredOptions, onSelect, onCancel};
	}, [pickerOwner, isOwner, isDisabled, filteredOptions, onSelect, onCancel]);
	const handleFilterChange = useCallback((value: string) => {
		const current = interaction.current;
		if (!current.isOwner(current.pickerOwner) || current.isDisabled) return;
		setQuery(value);
		onQueryChange?.(value);
	}, [onQueryChange]);
	// Select calls onChange in an effect; a stable callback prevents repeat selections.
	const handleChange = useCallback((value: string) => {
		const current = interaction.current;
		if (!current.isOwner(current.pickerOwner) || current.isDisabled) return;
		const option = current.options.find(candidate => candidate.value === value);
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
			{filterable && <Box><Text color={palette.muted}>Filter: </Text><TextInput key={owner} defaultValue={query} placeholder={filterPlaceholder} isDisabled={isDisabled} onChange={handleFilterChange} /></Box>}
			{filteredOptions.length > 0
				? <Select key={filterable ? JSON.stringify([resetKey, query, filteredOptions.map(option => option.value)]) : resetKey} options={filteredOptions} isDisabled={isDisabled} onChange={handleChange} />
				: <Text color={palette.muted}>No matching options</Text>}
		</Box>
	);
}
