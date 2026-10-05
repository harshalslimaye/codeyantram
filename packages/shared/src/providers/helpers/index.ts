export * from './preferences.js';

import {readConfig, writeConfig} from '../../filesystem/config.js';
import {asObject} from '../../utils/objects.js';
import {findSupportedChatModel, SUPPORTED_PROVIDERS, type ConnectableProvider, type ProviderCredentials, type SupportedProvider} from '../config/index.js';

function readApiKey(providers: Record<string, unknown>, provider: SupportedProvider): string | undefined {
	const {apiKey} = asObject(providers[provider]);
	return typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : undefined;
}

export async function readConfiguredProviders(): Promise<SupportedProvider[]> {
	const config = await readConfig();
	const providers = asObject(config.providers);
	return SUPPORTED_PROVIDERS.filter(provider => readApiKey(providers, provider) !== undefined);
}

export async function saveProviderApiKey(provider: ConnectableProvider, apiKey: string): Promise<void> {
	if (provider !== 'typesafe' && !SUPPORTED_PROVIDERS.includes(provider)) throw new Error('Unsupported provider.');
	const key = apiKey.trim();
	if (!key) throw new Error('An API key is required.');
	const config = await readConfig();
	const providers = asObject(config.providers);
	await writeConfig({
		...config,
		providers: {
			...providers,
			[provider]: {...asObject(providers[provider]), apiKey: key},
		},
	});
}

/** Reads only the selected model's provider key from user configuration. */
export async function readProviderCredentials(
	modelId: string,
	readConfiguration: typeof readConfig = readConfig,
): Promise<ProviderCredentials> {
	const model = findSupportedChatModel(modelId);
	if (!model) return {};

	const config = await readConfiguration();
	const apiKey = readApiKey(asObject(config.providers), model.provider);
	return apiKey === undefined ? {} : {[model.provider]: apiKey};
}
