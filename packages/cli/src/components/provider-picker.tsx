import React, {useEffect, useMemo, useState} from 'react';
import {Spinner} from '@inkjs/ui';
import {readConfiguredProviders, readJevConfiguration, SUPPORTED_PROVIDERS, type ConnectableProvider} from '@codeyantram/shared';
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

export function ProviderPicker() {
	const [configuredProviders, setConfiguredProviders] = useState<ConnectableProvider[]>([]);
	const [selectedProvider, setSelectedProvider] = useState<ConnectableProvider>();
	const [isLoading, setIsLoading] = useState(true);
	const {owner, push, pop} = useKeyboardOwner();
	const {setNotice} = useTheme();

	useEffect(() => {
		let active = true;
		void Promise.all([readConfiguredProviders(), readJevConfiguration()])
			.then(([providers, jev]) => { if (active) setConfiguredProviders([...providers, ...(jev.configured ? ['typesafe' as const] : [])]); })
			.catch(() => { if (active) setNotice('Could not read provider configuration.', 'error'); })
			.finally(() => { if (active) setIsLoading(false); });
		return () => { active = false; };
	}, []);

	const options = useMemo(() => CONNECTABLE_PROVIDERS.map(provider => ({
		value: provider,
		label: `${PROVIDER_NAMES[provider]}${configuredProviders.includes(provider) ? ' · configured' : ''}`,
	})), [configuredProviders]);

	function selectProvider(provider: ConnectableProvider) {
		setNotice(undefined);
		setSelectedProvider(provider);
		push('api-key-input');
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
			{owner === 'api-key-input' && selectedProvider && (
				<ApiKeyInput
					provider={selectedProvider}
					providerName={PROVIDER_NAMES[selectedProvider]}
					onSaved={() => {
						pop('provider-picker');
						setNotice(`${PROVIDER_NAMES[selectedProvider]} API key saved to user config.`);
					}}
				/>
			)}
		</>
	);
}
