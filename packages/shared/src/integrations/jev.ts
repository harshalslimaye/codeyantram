import {readConfig, writeConfig} from '../filesystem/config.js';
import {asObject} from '../utils/objects.js';

/** Public configuration status deliberately omits the credential. */
export interface JevConfiguration {
	enabled: boolean;
	configured: boolean;
}

export class JevNotConfiguredError extends Error {
	constructor() {
		super('Configure TypeSafe (JEV) through /connect before enabling JEV usage.');
		this.name = 'JevNotConfiguredError';
	}
}

export function resolveJevConfiguration(config: Record<string, unknown>): JevConfiguration {
	const {apiKey} = asObject(asObject(config.providers).typesafe);
	const settings = asObject(asObject(config.integrations).jev);
	return {
		enabled: settings.enabled === true,
		configured: typeof apiKey === 'string' && Boolean(apiKey.trim()),
	};
}

export async function readJevConfiguration(): Promise<JevConfiguration> {
	return resolveJevConfiguration(await readConfig());
}

/** Toggle only the opt-in preference; preserve the key and unrelated configuration. */
export async function toggleJevUsage(): Promise<JevConfiguration> {
	const config = await readConfig();
	const current = resolveJevConfiguration(config);
	const enabled = !current.enabled;
	if (enabled && !current.configured) throw new JevNotConfiguredError();
	const integrations = asObject(config.integrations);
	await writeConfig({
		...config,
		integrations: {
			...integrations,
			jev: {...asObject(integrations.jev), enabled},
		},
	});
	return {...current, enabled};
}
