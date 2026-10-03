import React, {useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {PasswordInput, Spinner} from '@inkjs/ui';
import type {SupportedProvider} from '@codeyantram/shared';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useTheme} from '../theme/provider.js';
import {saveProviderApiKey} from '../providers/config.js';

export function ApiKeyInput({provider, providerName, onSaved}: {
	provider: SupportedProvider;
	providerName: string;
	onSaved: () => void;
}) {
	const [isSaving, setIsSaving] = useState(false);
	const saving = useRef(false);
	const {owner, isOwner, pop} = useKeyboardOwner();
	const {palette, setNotice} = useTheme();

	async function saveKey(apiKey: string) {
		if (!isOwner('api-key-input') || saving.current) return;
		if (!apiKey.trim()) {
			setNotice('Enter an API key.', 'error');
			return;
		}
		saving.current = true;
		setIsSaving(true);
		setNotice(undefined);
		try {
			await saveProviderApiKey(provider, apiKey);
			pop('api-key-input');
			onSaved();
		} catch {
			setNotice('Could not save the API key. Check your user config and try again.', 'error');
		} finally {
			saving.current = false;
			setIsSaving(false);
		}
	}

	useInput((_input, key) => {
		if (isOwner('api-key-input') && !saving.current && key.escape) {
			setNotice(undefined);
			pop('api-key-input');
		}
	}, {isActive: owner === 'api-key-input'});

	return (
		<>
			<Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
				<Text color={palette.muted}>Enter API key for {providerName} · Enter save · Esc back</Text>
				<PasswordInput
					placeholder="API key"
					isDisabled={isSaving || owner !== 'api-key-input'}
					onSubmit={apiKey => { void saveKey(apiKey); }}
				/>
			</Box>
			{isSaving && <Spinner label="Saving API key…" />}
		</>
	);
}
