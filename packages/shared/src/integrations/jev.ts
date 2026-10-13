import {readConfig, writeConfig} from '../filesystem/config.js';
import {asObject} from '../utils/objects.js';

export const DEFAULT_JEV_RETENTION_THRESHOLD = 0.2;
export const DEFAULT_JEV_NEIGHBOR_THRESHOLD = 0.5;

/** Invalid settings fall back to the default; zero keeps all judged evidence. */
export function resolveJevRetentionThreshold(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
		? value : DEFAULT_JEV_RETENTION_THRESHOLD;
}

export function resolveJevNeighborThreshold(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
		? value : DEFAULT_JEV_NEIGHBOR_THRESHOLD;
}

/** Public configuration status deliberately omits the credential. */
export interface JevConfiguration {
	enabled: boolean;
	configured: boolean;
	retentionThreshold?: number;
	neighborThreshold?: number;
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
		retentionThreshold: resolveJevRetentionThreshold(settings.retentionThreshold),
		neighborThreshold: resolveJevNeighborThreshold(settings.neighborThreshold),
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
