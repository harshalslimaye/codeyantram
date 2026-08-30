import { readJsonFile, writeJsonFile } from './local-store';
import { SUPPORTED_PROVIDERS, type SupportedProvider } from './models';

const AUTH_FILE = 'auth.json';

export type AuthEntry = {
    type: 'api';
    key: string;
};

export type AuthStore = Partial<Record<SupportedProvider, AuthEntry>>;

export function readAuth(): AuthStore {
    return readJsonFile<AuthStore>(AUTH_FILE) ?? {};
}

/** Merges the key over whatever is currently on disk, so one provider's save can never erase another's. */
export function writeAuthKey(provider: SupportedProvider, key: string): void {
    const current = readAuth();
    current[provider] = { type: 'api', key };
    writeJsonFile(AUTH_FILE, current, { mode: 0o600 });
}

export function removeAuthKey(provider: SupportedProvider): void {
    const current = readAuth();
    delete current[provider];
    writeJsonFile(AUTH_FILE, current, { mode: 0o600 });
}

export function getConfiguredProviders(): SupportedProvider[] {
    const store = readAuth();
    return SUPPORTED_PROVIDERS.filter(provider => store[provider] !== undefined);
}
