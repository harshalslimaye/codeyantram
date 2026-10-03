import {readConfig, writeConfig, SUPPORTED_PROVIDERS, type SupportedProvider} from '@codeyantram/shared';

function asObject(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

export async function readConfiguredProviders(): Promise<SupportedProvider[]> {
	const config = await readConfig();
	const providers = asObject(config.providers);
	return SUPPORTED_PROVIDERS.filter(provider => {
		const {apiKey} = asObject(providers[provider]);
		return typeof apiKey === 'string' && apiKey.trim().length > 0;
	});
}

export async function saveProviderApiKey(provider: SupportedProvider, apiKey: string): Promise<void> {
	if (!SUPPORTED_PROVIDERS.includes(provider)) throw new Error('Unsupported provider.');
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
