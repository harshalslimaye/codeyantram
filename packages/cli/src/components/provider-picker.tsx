import React, {useEffect, useMemo, useState} from 'react';
import {Spinner} from '@inkjs/ui';
import {readConfiguredProviders, SUPPORTED_PROVIDERS, type SupportedProvider} from '@codeyantram/shared';
import {Picker} from './picker.js';
import {ApiKeyInput} from './api-key-input.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useTheme} from '../theme/provider.js';

const PROVIDER_NAMES: Record<SupportedProvider, string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	google: 'Google',
};

export function ProviderPicker() {
	const [configuredProviders, setConfiguredProviders] = useState<SupportedProvider[]>([]);
	const [selectedProvider, setSelectedProvider] = useState<SupportedProvider>();
	const [isLoading, setIsLoading] = useState(true);
	const {owner, push, pop} = useKeyboardOwner();
	const {setNotice} = useTheme();

	useEffect(() => {
		let active = true;
		void readConfiguredProviders()
			.then(providers => { if (active) setConfiguredProviders(providers); })
			.catch(() => { if (active) setNotice('Could not read provider configuration.', 'error'); })
			.finally(() => { if (active) setIsLoading(false); });
		return () => { active = false; };
	}, []);

	const options = useMemo(() => SUPPORTED_PROVIDERS.map(provider => ({
		value: provider,
		label: `${PROVIDER_NAMES[provider]}${configuredProviders.includes(provider) ? ' · configured' : ''}`,
	})), [configuredProviders]);

	function selectProvider(provider: SupportedProvider) {
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
