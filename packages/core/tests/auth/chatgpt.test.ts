import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SignJWT, exportJWK, generateKeyPair} from 'jose';
import {signInChatGPT} from '@codeyantram/ai-sdk-provider-chatgpt/node';
import {ChatGPTSessionService} from '../../src/auth/chatgpt/session.js';

const ISSUER = 'https://auth.openai.com';
const CLIENT = 'oaiapp_test_issued_client';
const HOST = 'urn:uuid:75431ca3-30b1-4f1d-a8a6-62b711564572';
const directories: string[] = [];
afterEach(async () => {for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true});});

async function mockIssuer(expiresIn = 3600) {
  const {publicKey, privateKey} = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(publicKey), kid: 'test-key', use: 'sig', alg: 'RS256'};
  const requested: Array<{url: string; body?: URLSearchParams}> = [];
  let tokenNumber = 0;
  let nonce = '';
  const fetcher = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, init) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    const body = init?.body instanceof URLSearchParams ? init.body : undefined;
    requested.push({url, body});
    if (url.endsWith('/.well-known/jwks.json')) return Response.json({keys: [jwk]});
    if (url.endsWith('/api/accounts/oauth/token')) {
      tokenNumber += 1;
      const idToken = await new SignJWT({email: 'person@example.com', nonce})
        .setProtectedHeader({alg: 'RS256', kid: 'test-key'}).setIssuer(ISSUER).setAudience(CLIENT)
        .setSubject('person-1').setIssuedAt().setExpirationTime('1h').sign(privateKey);
      return Response.json({access_token: `access-${tokenNumber}`, refresh_token: `refresh-${tokenNumber}`, id_token: idToken,
        scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', expires_in: expiresIn});
    }
    if (url.endsWith('/models')) return Response.json({models: [{slug: 'gpt-6.1-sol', display_name: 'GPT 6.1 Sol', visibility: 'list'}]});
    throw new Error(`Unexpected mock request: ${url}`);
  });
  const openBrowser = async (address: string) => {
    const authorization = new URL(address);
    nonce = authorization.searchParams.get('nonce') ?? '';
    expect(authorization.origin).toBe(ISSUER);
    expect(authorization.pathname).toBe('/api/accounts/authorize');
    expect(authorization.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(authorization.searchParams.get('agent_name_hint')).toBe('CodeYantram');
    expect(authorization.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:[0-9a-f-]+$/);
    expect(authorization.searchParams.get('resource')).toBe('https://api.openai.com/v1');
    const redirect = new URL(authorization.searchParams.get('redirect_uri') ?? '');
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(redirect.pathname).toBe('/auth/callback');
    redirect.searchParams.set('code', 'authorization-code');
    redirect.searchParams.set('state', authorization.searchParams.get('state') ?? '');
    redirect.searchParams.set('client_id', CLIENT);
    expect((await fetch(redirect)).status).toBe(200);
    return authorization;
  };
  return {fetcher, openBrowser, requested};
}

describe('ChatGPT local OAuth', () => {
  it('registers its own client, validates PKCE and ID token, and stores protected credentials', async () => {
    const issuer = await mockIssuer();
    let authorization: URL | undefined;
    const directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-chatgpt-'));
    directories.push(directory);
    const session = new ChatGPTSessionService({directory, fetch: issuer.fetcher,
      openBrowser: async address => {authorization = await issuer.openBrowser(address);}});
    const status = await session.login();
    expect(status.selectedId).toBe(CLIENT);
    expect(status.profiles).toMatchObject([{id: CLIENT, email: 'person@example.com', sharing: true}]);
    expect(await session.accessToken()).toBe('access-1');
    expect(await session.models()).toMatchObject([{slug: 'gpt-6.1-sol', displayName: 'GPT 6.1 Sol'}]);
    const tokenCall = issuer.requested.find(item => item.url.endsWith('/api/accounts/oauth/token'));
    expect(tokenCall?.body?.get('client_id')).toBe(CLIENT);
    expect(tokenCall?.body?.get('resource')).toBe('https://api.openai.com/v1');
    expect(tokenCall?.body?.get('redirect_uri')).toBe(authorization?.searchParams.get('redirect_uri'));
    const verifier = tokenCall?.body?.get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(authorization?.searchParams.get('code_challenge'));
    const file = path.join(directory, 'profiles.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({selectedId: CLIENT});
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o077).toBe(0);
  });

  it('rejects a callback with the wrong state before exchanging a token', async () => {
    const issuer = await mockIssuer();
    await expect(signInChatGPT({appName: 'CodeYantram', hostId: HOST, fetch: issuer.fetcher,
      openBrowser: async address => {
        const redirect = new URL(new URL(address).searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('code', 'authorization-code');
        redirect.searchParams.set('state', 'wrong-state');
        redirect.searchParams.set('client_id', CLIENT);
        expect((await fetch(redirect)).status).toBe(400);
      }})).rejects.toThrow('state mismatch');
    expect(issuer.requested).toEqual([]);
  });

  it('rotates refresh credentials atomically when the access token is near expiry', async () => {
    const issuer = await mockIssuer(1);
    const directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-chatgpt-'));
    directories.push(directory);
    const session = new ChatGPTSessionService({directory, fetch: issuer.fetcher, openBrowser: async address => {await issuer.openBrowser(address);}});
    await session.login();
    expect(await session.accessToken()).toBe('access-2');
    const exchanges = issuer.requested.filter(item => item.url.endsWith('/api/accounts/oauth/token'));
    expect(exchanges.map(item => item.body?.get('grant_type'))).toEqual(['authorization_code', 'refresh_token']);
    expect(exchanges[1]?.body?.get('refresh_token')).toBe('refresh-1');
    const saved = JSON.parse(await readFile(path.join(directory, 'profiles.json'), 'utf8')) as {profiles: Record<string, {refreshToken: string}>};
    expect(Object.values(saved.profiles)[0]?.refreshToken).toBe('refresh-2');
  });
});
