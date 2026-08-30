import { PROVIDER_ENV_VARS, SUPPORTED_PROVIDERS, readAuth, type SupportedProvider } from '@codeyantram/shared';

/**
 * Checks the /connect-managed auth store first, then falls back to the
 * provider's env var - so a key set either way is usable at chat time.
 */
export function resolveApiKey(provider: SupportedProvider): string | undefined {
    return readAuth()[provider]?.key ?? process.env[PROVIDER_ENV_VARS[provider]];
}

/** Providers the server can actually call right now, from either source above. */
export function getUsableProviders(): SupportedProvider[] {
    return SUPPORTED_PROVIDERS.filter(provider => resolveApiKey(provider) !== undefined);
}
