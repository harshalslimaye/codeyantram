import React, {useMemo} from 'react';
import type {EffortLevel, SupportedChatModelDefinition} from '@codeyantram/shared';
import {Picker} from './picker.js';
import {useKeyboardOwner} from '../keyboard/provider.js';

export function EffortPicker({model, preferredEffort, isSaving, onSelect}: {
	model: SupportedChatModelDefinition;
	preferredEffort?: EffortLevel;
	isSaving: boolean;
	onSelect: (effort: EffortLevel) => void;
}) {
	const {pop} = useKeyboardOwner();
	const options = useMemo(() => [...model.supportedEffortLevels]
		.sort((left, right) => Number(right === preferredEffort) - Number(left === preferredEffort))
		.map(effort => ({
			value: effort,
			label: `${effort}${effort === preferredEffort ? ' · selected' : ''}${effort === model.defaultEffortLevel ? ' · default' : ''}`,
		})), [model, preferredEffort]);

	return (
		<Picker
			owner="effort-picker"
			title={`Choose effort for ${model.id} · ↑/↓ navigate · Enter select · Esc back`}
			options={options}
			isDisabled={isSaving}
			onSelect={onSelect}
			onCancel={() => pop('effort-picker')}
		/>
	);
}
