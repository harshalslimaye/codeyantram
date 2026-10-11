/* oxlint-disable eslint/complexity, eslint/max-statements, eslint/no-magic-numbers, eslint/no-nested-ternary, typescript/strict-boolean-expressions, security/detect-object-injection, security/detect-non-literal-fs-filename -- Credential paths use the configured private directory, file modes are checked, and profile keys are validated with Object.hasOwn. */
import {randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, lstat, unlink, rm} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {getUserConfigDirectory} from '@codeyantram/shared';
import {listChatGPTModels, type ChatGPTModel} from '@codeyantram/ai-sdk-provider-chatgpt';
import {ChatGPTOAuthError, signInChatGPT, refreshChatGPT, revokeChatGPT, type ChatGPTConnection} from '@codeyantram/ai-sdk-provider-chatgpt/node';

const REFRESH_MARGIN_MS = 5 * 60_000;
const REVOCATION_TIMEOUT_MS = 10_000;
const CACHE_MS = 5 * 60_000;
const LOCK_WAIT_ATTEMPTS = 100;
const LOCK_WAIT_MS = 100;
const TERMINAL_REFRESH_CODES = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired',
  'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

const connectionSchema = z.object({
  clientId: z.string().min(1), subject: z.string().min(1), email: z.string().optional(),
  idToken: z.string().min(1), accessToken: z.string().min(1), refreshToken: z.string().min(1),
  scopes: z.array(z.string()), expiresAt: z.number(), earliestRefreshAt: z.number().optional(),
});
const storeSchema = z.object({hostId: z.string().startsWith('urn:uuid:'), selectedId: z.string().optional(),
  pendingClientId: z.string().optional(), profiles: z.record(z.string(), connectionSchema),
  registrations: z.record(z.string(), z.object({subject: z.string().min(1), email: z.string().optional()})).default({})});
type Store = z.infer<typeof storeSchema>;
function profileFor(store: Store, id: string | undefined): ChatGPTConnection | undefined {
  return id !== undefined && Object.hasOwn(store.profiles, id) ? store.profiles[id] : undefined;
}

export interface ChatGPTStatus {
  selectedId?: string;
  profiles: Array<{id: string; email?: string; connected: boolean; sharing: boolean}>;
}

export interface ChatGPTSessionOptions {
  directory?: string;
  fetch?: typeof globalThis.fetch;
  openBrowser: (url: string) => void | Promise<void>;
  onLogin?: () => Promise<void>;
}

export class ChatGPTSessionService {
  private readonly directory: string;
  private readonly file: string;
  private readonly fetcher: typeof fetch;
  private readonly openBrowser: ChatGPTSessionOptions['openBrowser'];
  private readonly onLogin?: ChatGPTSessionOptions['onLogin'];
  private catalog?: {profileId: string; at: number; models: ChatGPTModel[]};
  private loginActive = false;

  constructor(options: ChatGPTSessionOptions) {
    this.directory = options.directory ?? path.join(getUserConfigDirectory(), 'chatgpt');
    this.file = path.join(this.directory, 'profiles.json');
    this.fetcher = options.fetch ?? fetch;
    this.openBrowser = options.openBrowser;
    this.onLogin = options.onLogin;
  }

  async status(): Promise<ChatGPTStatus> {
    const store = await this.read();
    const ids = new Set([...Object.keys(store.registrations), ...Object.keys(store.profiles)]);
    return {selectedId: store.selectedId, profiles: [...ids].map(id => {
      const profile = profileFor(store, id);
      const identity = Object.hasOwn(store.registrations, id) ? store.registrations[id] : undefined;
      const email = profile?.email ?? identity?.email;
      return {id, ...(email ? {email} : {}), connected: profile !== undefined,
        sharing: profile?.scopes.includes('chatgpt.tokens.use.direct') ?? false};
    })};
  }

  async selected(): Promise<ChatGPTConnection | undefined> {
    const store = await this.read();
    return profileFor(store, store.selectedId);
  }

  async login(profileId?: string, signal?: AbortSignal): Promise<ChatGPTStatus> {
    if (this.loginActive) throw new Error('A ChatGPT sign-in is already in progress.');
    this.loginActive = true;
    try {
      const store = await this.read();
      const newRegistration = profileId === 'new';
      const registeredId = newRegistration ? undefined : profileId ?? store.selectedId ??
        (Object.keys(store.registrations).length === 1 ? Object.keys(store.registrations)[0] : undefined);
      const existing = profileFor(store, registeredId);
      const registration = registeredId !== undefined && Object.hasOwn(store.registrations, registeredId)
        ? store.registrations[registeredId] : undefined;
      if (profileId !== undefined && !newRegistration && existing === undefined && registration === undefined) throw new Error('ChatGPT profile is unavailable.');
      const connection = await signInChatGPT({appName: 'CodeYantram', hostId: store.hostId,
        ...(existing !== undefined ? {existing} : registration !== undefined && registeredId !== undefined
          ? {existingClientId: registeredId, expectedSubject: registration.subject}
            : !newRegistration && store.pendingClientId !== undefined ? {existingClientId: store.pendingClientId} : {}),
        promptConsent: existing !== undefined && !existing.scopes.includes('chatgpt.tokens.use.direct'),
        openBrowser: this.openBrowser, fetch: this.fetcher, signal,
        onIssuedClientId: clientId => this.update(next => ({...next, pendingClientId: clientId})),
      });
      await this.onLogin?.();
      await this.update(next => ({...next, selectedId: connection.clientId, pendingClientId: undefined,
        profiles: {...next.profiles, [connection.clientId]: connection},
        registrations: {...next.registrations, [connection.clientId]: {subject: connection.subject,
          ...(connection.email ? {email: connection.email} : {})}}}));
      this.catalog = undefined;
      return this.status();
    } finally {this.loginActive = false;}
  }

  async select(profileId: string): Promise<ChatGPTStatus> {
    if (profileFor(await this.read(), profileId) === undefined) throw new Error('ChatGPT profile is unavailable.');
    await this.onLogin?.();
    await this.update(store => {
      if (profileFor(store, profileId) === undefined) throw new Error('ChatGPT profile is unavailable.');
      return {...store, selectedId: profileId};
    });
    this.catalog = undefined;
    return this.status();
  }

  async logout(profileId?: string): Promise<{status: ChatGPTStatus; revoked: boolean}> {
    const store = await this.read();
    const id = profileId ?? store.selectedId;
    const profile = profileFor(store, id);
    if (id === undefined || profile === undefined) return {status: await this.status(), revoked: true};
    let revoked = true;
    try {await revokeChatGPT(profile, this.fetcher);} catch {revoked = false;}
    await this.update(next => {
      const profiles = {...next.profiles}; delete profiles[id];
      return {...next, profiles, selectedId: next.selectedId === id ? Object.keys(profiles)[0] : next.selectedId,
        registrations: {...next.registrations, [id]: {subject: profile.subject,
          ...(profile.email ? {email: profile.email} : {})}}};
    });
    this.catalog = undefined;
    return {status: await this.status(), revoked};
  }

  /** Removes every local ChatGPT credential before attempting remote revocation. */
  async logoutAll(): Promise<{revoked: boolean}> {
    const store = await this.read();
    const profiles = Object.values(store.profiles);
    await this.update(next => ({...next, selectedId: undefined, pendingClientId: undefined,
      profiles: {}, registrations: {}}));
    this.catalog = undefined;
    const results = await Promise.all(profiles.map(profile => revokeChatGPT(profile, this.fetcher, AbortSignal.timeout(REVOCATION_TIMEOUT_MS))
      .then(() => true).catch(() => false)));
    return {revoked: results.every(Boolean)};
  }

  async accessToken(profileId?: string, signal?: AbortSignal): Promise<string> {
    const store = await this.read();
    const id = profileId ?? store.selectedId;
    const selected = profileFor(store, id);
    if (id === undefined || selected === undefined) throw new Error('Sign in with ChatGPT first.');
    if (!selected.scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan usage was not granted.');
    if (Date.now() + REFRESH_MARGIN_MS < selected.expiresAt) return selected.accessToken;
    let accessToken = '';
    let refreshRejected = false;
    await this.update(async next => {
      const current = profileFor(next, id);
      if (current === undefined) throw new Error('ChatGPT profile was removed.');
      if (Date.now() + REFRESH_MARGIN_MS < current.expiresAt) {accessToken = current.accessToken; return next;}
      if (current.earliestRefreshAt && Date.now() < current.earliestRefreshAt) throw new Error('ChatGPT token cannot be refreshed yet.');
      let refreshed: ChatGPTConnection;
      try {refreshed = await refreshChatGPT(current, this.fetcher, signal);} catch (error) {
        if (!(error instanceof ChatGPTOAuthError) || !error.code || !TERMINAL_REFRESH_CODES.has(error.code)) throw error;
        refreshRejected = true;
        const profiles = {...next.profiles}; delete profiles[id];
        return {...next, profiles, selectedId: next.selectedId === id ? Object.keys(profiles)[0] : next.selectedId,
          registrations: {...next.registrations, [id]: {subject: current.subject,
            ...(current.email ? {email: current.email} : {})}}};
      }
      accessToken = refreshed.accessToken;
      return {...next, profiles: {...next.profiles, [id]: refreshed}};
    });
    if (refreshRejected) {
      this.catalog = undefined;
      throw new Error('ChatGPT session expired or was disconnected. Use /chatgpt login to sign in again.');
    }
    return accessToken;
  }

  async models(signal?: AbortSignal): Promise<ChatGPTModel[]> {
    const store = await this.read();
    if (!store.selectedId) return [];
    if (this.catalog?.profileId === store.selectedId && Date.now() - this.catalog.at < CACHE_MS) return this.catalog.models;
    const token = await this.accessToken(store.selectedId, signal);
    const models = await listChatGPTModels(token, this.fetcher, signal);
    this.catalog = {profileId: store.selectedId, at: Date.now(), models};
    return models;
  }

  async model(slug: string, signal?: AbortSignal): Promise<ChatGPTModel> {
    const model = (await this.models(signal)).find(item => item.slug === slug);
    if (!model) throw new Error('This ChatGPT model is unavailable to the selected account.');
    return model;
  }

  private async read(): Promise<Store> {
    try {
      const info = await lstat(this.file);
      if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('ChatGPT credential file permissions are unsafe.');
      return storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let created: Store | undefined;
      await this.update(store => {created = store; return store;});
      if (!created) throw new Error('Could not initialize ChatGPT profile store.');
      return created;
    }
  }

  private async update(change: (store: Store) => Store | Promise<Store>): Promise<void> {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    const dirInfo = await lstat(this.directory);
    if (!dirInfo.isDirectory() || (process.platform !== 'win32' && (dirInfo.mode & 0o077) !== 0)) throw new Error('ChatGPT credential directory permissions are unsafe.');
    const lock = `${this.file}.lock`;
    for (let attempts = 0; ; attempts++) {
      try {await mkdir(lock); break;} catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (attempts >= LOCK_WAIT_ATTEMPTS) throw new Error(`ChatGPT credential store is busy. If no CodeYantram process is running, remove ${lock} and retry.`);
        await delay(LOCK_WAIT_MS);
      }
    }
    try {
      let store: Store;
      try {
        const info = await lstat(this.file);
        if (!info.isFile() || info.nlink !== 1 || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
          throw new Error('ChatGPT credential file permissions are unsafe.');
        }
        store = storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8')) as unknown);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        store = {hostId: `urn:uuid:${randomUUID()}`, profiles: {}, registrations: {}};
      }
      const next = storeSchema.parse(await change(store));
      const temporary = path.join(this.directory, `.profiles-${randomUUID()}.tmp`);
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try {await handle.writeFile(`${JSON.stringify(next)}\n`); await handle.sync();} finally {await handle.close();}
        await rename(temporary, this.file);
      } finally {await unlink(temporary).catch(() => {});}
    } finally {await rm(lock, {recursive: true, force: true});}
  }
}
