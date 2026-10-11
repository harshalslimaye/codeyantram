/* oxlint-disable eslint/complexity, eslint/max-statements, eslint/max-lines-per-function, eslint/no-magic-numbers, typescript/strict-boolean-expressions -- The bounded OAuth callback state machine checks each callback and token condition explicitly. */
import {createHash, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRemoteJWKSet, customFetch, jwtVerify} from 'jose';
import {z} from 'zod';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const TIMEOUT_MS = 5 * 60_000;

const tokenSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1),
  id_token: z.string().min(1).optional(), scope: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().positive().optional(), earliest_refresh_at: z.union([z.number(), z.string()]).optional(),
}).loose();

export interface ChatGPTConnection {
  clientId: string;
  subject: string;
  email?: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: number;
  earliestRefreshAt?: number;
}

export interface ChatGPTSignInOptions {
  appName: string;
  hostId: string;
  existing?: ChatGPTConnection;
  existingClientId?: string;
  expectedSubject?: string;
  promptConsent?: boolean;
  openBrowser: (url: string) => void | Promise<void>;
  onIssuedClientId?: (clientId: string) => void | Promise<void>;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function signInChatGPT(options: ChatGPTSignInOptions): Promise<ChatGPTConnection> {
  if (options.signal?.aborted) throw new Error('ChatGPT sign-in cancelled.');
  const fetcher = options.fetch ?? fetch;
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let settle: ((value: {code: string; clientId: string}) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const callback = new Promise<{code: string; clientId: string}>((resolve, reject) => {settle = resolve; fail = reject;});
  void callback.catch(() => {});
  let received = false;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (url.pathname !== '/auth/callback') {response.writeHead(404).end('Not found'); return;}
    if (received) {response.writeHead(409).end('Sign-in already handled.'); return;}
    received = true;
    if (url.searchParams.get('state') !== state) {
      response.writeHead(400).end('Invalid sign-in state.'); fail?.(new Error('ChatGPT sign-in state mismatch.')); return;
    }
    const oauthError = url.searchParams.get('error');
    if (oauthError) {response.writeHead(400).end('Sign-in was not completed.'); fail?.(new Error(`ChatGPT sign-in failed: ${oauthError}.`)); return;}
    const code = url.searchParams.get('code');
    const savedClientId = options.existing?.clientId ?? options.existingClientId;
    const clientId = url.searchParams.get('client_id') ?? savedClientId;
    if (!code || !clientId || clientId === 'dynamic_agent_client' || (savedClientId && clientId !== savedClientId)) {
      response.writeHead(400).end('Invalid sign-in callback.'); fail?.(new Error('ChatGPT sign-in callback lacks a valid code or client ID.')); return;
    }
    response.writeHead(200).end('ChatGPT sign-in received. Return to CodeYantram.');
    settle?.({code, clientId});
  });
  const onAbort = () => fail?.(new Error('ChatGPT sign-in cancelled.'));
  options.signal?.addEventListener('abort', onAbort, {once: true});
  const timer = setTimeout(() => fail?.(new Error('ChatGPT sign-in timed out.')), options.timeoutMs ?? TIMEOUT_MS);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not start ChatGPT callback listener.');
    const redirect = `http://127.0.0.1:${address.port}/auth/callback`;
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    const params = url.searchParams;
    params.set('response_type', 'code');
    params.set('client_id', options.existing?.clientId ?? options.existingClientId ?? 'dynamic_agent_client');
    if (!options.existing && !options.existingClientId) params.set('agent_name_hint', options.appName);
    params.set('ext_agent_host_id', options.hostId);
    params.set('redirect_uri', redirect);
    params.set('scope', SCOPE);
    params.set('resource', RESOURCE);
    params.set('state', state);
    params.set('nonce', nonce);
    params.set('code_challenge_method', 'S256');
    params.set('code_challenge', challenge);
    if (options.existing?.idToken) params.set('id_token_hint', options.existing.idToken);
    if (options.existing?.email) params.set('login_hint', options.existing.email);
    if (options.promptConsent === true) params.set('prompt', 'consent');
    await options.openBrowser(url.href);
    const result = await callback;
    await options.onIssuedClientId?.(result.clientId);
    const token = await tokenRequest(new URLSearchParams({grant_type: 'authorization_code', client_id: result.clientId,
      code: result.code, code_verifier: verifier, redirect_uri: redirect, resource: RESOURCE}), fetcher, options.signal);
    if (!token.id_token) throw new Error('ChatGPT token response omitted the ID token.');
    const claims = await verifyIdentity(token.id_token, result.clientId, fetcher, {nonce, expectedSubject: options.existing?.subject ?? options.expectedSubject});
    const scopes = token.scope?.split(' ').filter(Boolean) ?? [];
    return {clientId: result.clientId, subject: claims.sub,
      ...(typeof claims.email === 'string' ? {email: claims.email} : {}),
      idToken: token.id_token, accessToken: token.access_token, refreshToken: token.refresh_token,
      scopes, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      ...(token.earliest_refresh_at === undefined ? {} : {earliestRefreshAt: Number(token.earliest_refresh_at) * 1000})};
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    server.closeAllConnections();
    server.close();
  }
}

export async function refreshChatGPT(connection: ChatGPTConnection, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<ChatGPTConnection> {
  const token = await tokenRequest(new URLSearchParams({grant_type: 'refresh_token', client_id: connection.clientId,
    refresh_token: connection.refreshToken, resource: RESOURCE}), fetcher, signal);
  if (token.id_token !== undefined) await verifyIdentity(token.id_token, connection.clientId, fetcher, {expectedSubject: connection.subject});
  return {...connection, accessToken: token.access_token, refreshToken: token.refresh_token,
    idToken: token.id_token ?? connection.idToken, scopes: token.scope?.split(' ').filter(Boolean) ?? connection.scopes,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    ...(token.earliest_refresh_at === undefined ? {} : {earliestRefreshAt: Number(token.earliest_refresh_at) * 1000})};
}

export async function revokeChatGPT(connection: ChatGPTConnection, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<void> {
  const discovery = await fetcher(`${ISSUER}/.well-known/openid-configuration`, {signal});
  if (!discovery.ok) throw new Error(`ChatGPT revocation discovery failed (HTTP ${discovery.status}).`);
  const document: unknown = await discovery.json();
  const url = document && typeof document === 'object' && 'revocation_endpoint' in document ? document.revocation_endpoint : undefined;
  if (typeof url !== 'string' || !url.startsWith(`${ISSUER}/`)) throw new Error('Invalid ChatGPT revocation endpoint.');
  const response = await fetcher(url, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({token: connection.refreshToken, token_type_hint: 'refresh_token', client_id: connection.clientId}), signal});
  if (!response.ok) throw new Error(`ChatGPT revocation failed (HTTP ${response.status}).`);
}

async function tokenRequest(form: URLSearchParams, fetcher: typeof fetch, signal?: AbortSignal) {
  const response = await fetcher(TOKEN_URL, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: form, signal});
  if (!response.ok) {
    let code: string | undefined;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') code = body.error;
    } catch { /* A non-JSON response still carries its HTTP status. */ }
    throw new ChatGPTOAuthError(response.status, code);
  }
  const token = tokenSchema.parse(await response.json());
  if (token.token_type !== undefined && token.token_type.toLowerCase() !== 'bearer') throw new Error('ChatGPT token type is not Bearer.');
  return token;
}

export class ChatGPTOAuthError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(`ChatGPT token request failed (HTTP ${status}${code ? `, ${code}` : ''}).`);
    this.name = 'ChatGPTOAuthError';
  }
}

async function verifyIdentity(idToken: string, clientId: string, fetcher: typeof fetch, expected: {nonce?: string; expectedSubject?: string}) {
  const claims = await jwtVerify(idToken, createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), {[customFetch]: fetcher}),
    {issuer: ISSUER, audience: clientId, algorithms: ['RS256']});
  if (typeof claims.payload.sub !== 'string' || (expected.nonce !== undefined && claims.payload.nonce !== expected.nonce)) {
    throw new Error('ChatGPT ID token nonce or subject is invalid.');
  }
  if (expected.expectedSubject !== undefined && expected.expectedSubject !== claims.payload.sub) throw new Error('A different ChatGPT account was selected.');
  return {sub: claims.payload.sub, email: claims.payload.email};
}
