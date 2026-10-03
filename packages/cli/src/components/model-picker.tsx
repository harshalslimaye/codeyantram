import React, {useCallback, useMemo, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Select, Spinner} from '@inkjs/ui';
import {
	findSupportedChatModel,
	modelHasEffortControl,
	SUPPORTED_CHAT_MODELS,
	type EffortLevel,
	type SupportedChatModelDefinition,
} from '@codeyantram/shared';
import {EffortPicker} from './effort-picker.js';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import type {ModelPreferences} from '../models/preferences.js';

export function ModelPicker({preferences, onSelect}: {
	preferences: ModelPreferences;
	onSelect: (id: string, effort?: EffortLevel) => Promise<void>;
}) {
	const [pendingModel, setPendingModel] = useState<SupportedChatModelDefinition>();
	const [isSaving, setIsSaving] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const saving = useRef(false);
	const {palette, setNotice} = useTheme();
	const {owner, isOwner, push, pop} = useKeyboardOwner();
	const options = useMemo(() => [...SUPPORTED_CHAT_MODELS]
		.sort((left, right) => Number(right.id === preferences.modelId) - Number(left.id === preferences.modelId))
		.map(model => ({
			value: model.id,
			label: `${model.provider.padEnd(10)} ${model.id}${model.id === preferences.modelId ? ' · active' : ''}`,
		})), [preferences.modelId]);

	async function saveModel(model: SupportedChatModelDefinition, effort?: EffortLevel) {
		if (saving.current || (!isOwner('model-picker') && !isOwner('effort-picker'))) return;
		saving.current = true;
		setIsSaving(true);
		try {
			await onSelect(model.id, effort);
			pop('effort-picker');
			pop('model-picker');
			setNotice(`Using ${model.id}${effort ? ` · ${effort}` : ''}; saved to user config.`);
		} catch (error) {
			setNotice(`Could not save model: ${String(error)}`, 'error');
			// Remount Select so the same choice can be retried after a failed save.
			setAttempt(previous => previous + 1);
		} finally {
			saving.current = false;
			setIsSaving(false);
		}
	}

	function selectModel(id: string) {
		if (!isOwner('model-picker') || saving.current) return;
		const model = findSupportedChatModel(id);
		if (!model) return;
		setPendingModel(model);
		if (modelHasEffortControl(model)) push('effort-picker');
		else void saveModel(model);
	}

	const selectModelRef = useRef(selectModel);
	selectModelRef.current = selectModel;
	const handleChange = useCallback((id: string) => selectModelRef.current(id), []);

	useInput((_input, key) => {
		if (isOwner('model-picker') && !saving.current && key.escape) pop('model-picker');
	}, {isActive: owner === 'model-picker'});

	return (
		<>
			{owner === 'model-picker' && (
				<Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
					<Text color={palette.muted}>Choose a model · ↑/↓ navigate · Enter select · Esc close</Text>
					<Select key={attempt} options={options} isDisabled={isSaving} onChange={handleChange} />
				</Box>
			)}
			{owner === 'effort-picker' && pendingModel && (
				<EffortPicker
					key={attempt}
					model={pendingModel}
					preferredEffort={preferences.effortByModel[pendingModel.id] ?? pendingModel.defaultEffortLevel}
					isSaving={isSaving}
					onSelect={effort => { void saveModel(pendingModel, effort); }}
				/>
			)}
			{isSaving && <Spinner label="Saving model…" />}
		</>
	);
}
