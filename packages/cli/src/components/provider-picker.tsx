import React, {useEffect, useMemo, useState} from 'react';
import {Spinner} from '@inkjs/ui';
import {readConfiguredProviders, readJevConfiguration, SUPPORTED_PROVIDERS, type ConnectableProvider, type OpenAIConnection} from '@codeyantram/shared';
import {Picker} from './picker.js';
import {ApiKeyInput} from './api-key-input.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useTheme} from '../theme/provider.js';

const CONNECTABLE_PROVIDERS: readonly ConnectableProvider[] = [...SUPPORTED_PROVIDERS, 'typesafe'];
const PROVIDER_NAMES: Record<ConnectableProvider, string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	google: 'Google',
	typesafe: 'TypeSafe (JEV)',
};

export function ProviderPicker({onChatGPTLogin, onSaveKey, openaiConnection = 'api-key'}: {onChatGPTLogin?: () => void;
	openaiConnection?: OpenAIConnection;
	onSaveKey?: (provider: ConnectableProvider, apiKey: string) => Promise<void>}) {
	const {configuredProviders, isLoading} = useConfiguredProviders();
	const [selectedProvider, setSelectedProvider] = useState<ConnectableProvider>();
	const {owner, push, pop} = useKeyboardOwner();
	const {setNotice} = useTheme();

	const options = useMemo(() => CONNECTABLE_PROVIDERS.map(provider => {
		let state = configuredProviders.includes(provider) ? ' · configured' : '';
		if (provider === 'openai' && openaiConnection === 'chatgpt') state = ' · ChatGPT plan';
		return {value: provider, label: `${PROVIDER_NAMES[provider]}${state}`}; // oxlint-disable-line security/detect-object-injection -- Provider keys come from the supported provider union.
	}), [configuredProviders, openaiConnection]);

	function selectProvider(provider: ConnectableProvider) {
		setNotice(undefined);
		setSelectedProvider(provider);
		push(provider === 'openai' ? 'openai-auth-picker' : 'api-key-input');
	}

	return (
		<>
			<Picker
				owner="provider-picker"
				title="Choose a provider · ↑/↓ navigate · Enter select · Esc close"
				options={options}
				isDisabled={isLoading}
				onSelect={selectProvider}
				onCancel={() => pop('provider-picker')}
			/>
			{isLoading && <Spinner label="Loading providers…" />}
			{owner === 'openai-auth-picker' && <OpenAIConnectionChoice onApiKey={() => push('api-key-input')} onChatGPTLogin={onChatGPTLogin} />}
			{owner === 'api-key-input' && selectedProvider && (
				<ApiKeyInput
					provider={selectedProvider}
					onSaveKey={onSaveKey}
					providerName={PROVIDER_NAMES[selectedProvider]} // oxlint-disable-line security/detect-object-injection -- Provider keys come from the supported provider union.
					onSaved={() => {
						if (selectedProvider === 'openai') pop('openai-auth-picker');
						pop('provider-picker');
						setNotice(`${PROVIDER_NAMES[selectedProvider]} API key saved to user config.`); // oxlint-disable-line security/detect-object-injection -- Provider keys come from the supported provider union.
					}}
				/>
			)}
		</>
	);
}

function OpenAIConnectionChoice({onApiKey, onChatGPTLogin}: {onApiKey: () => void; onChatGPTLogin?: () => void}) {
	const {pop} = useKeyboardOwner();
	const {setNotice} = useTheme();
	function select(method: 'api-key' | 'login') {
		if (method === 'api-key') {onApiKey(); return;}
		pop('openai-auth-picker');
		pop('provider-picker');
		if (onChatGPTLogin) onChatGPTLogin();
		else setNotice('ChatGPT login is unavailable in this session.', 'error');
	}
	return <Picker owner="openai-auth-picker" title="Connect OpenAI · ↑/↓ navigate · Enter select · Esc back"
		options={[{value: 'api-key', label: 'API key · OpenAI API billing'},
			{value: 'login', label: 'Login · ChatGPT plan'}]}
		onSelect={select} onCancel={() => pop('openai-auth-picker')} />;
}

function useConfiguredProviders() {
	const [configuredProviders, setConfiguredProviders] = useState<ConnectableProvider[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const {setNotice} = useTheme();

	useEffect(() => {
		let active = true;
		void Promise.all([readConfiguredProviders(), readJevConfiguration()])
			.then(([providers, jev]) => { if (active) setConfiguredProviders([...providers, ...(jev.configured ? ['typesafe' as const] : [])]); return; })
			.catch(() => { if (active) setNotice('Could not read provider configuration.', 'error'); })
			.finally(() => { if (active) setIsLoading(false); });
		return () => { active = false; };
	}, [setNotice]);

	return {configuredProviders, isLoading};
}
