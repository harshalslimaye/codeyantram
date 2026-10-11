import {chatGPTSupportedEfforts, type EffortLevel} from '@codeyantram/shared';

export interface ChatGPTAccountModel {id: string; slug: string; displayName: string; contextWindow?: number; supportedEffortLevels?: readonly EffortLevel[]}
export interface ChatGPTAccount {id: string; email?: string; connected: boolean; sharing: boolean}
interface Status {selectedId?: string; profiles: ChatGPTAccount[]}
interface ChatGPTClient {baseUrl: string; fetcher: typeof fetch}

function isModel(value: unknown): value is {slug: string; displayName: string; contextWindow?: number; supportedEffortLevels?: string[]} {
  if (typeof value !== 'object' || value === null) return false;
  const model = value as Record<string, unknown>;
  return typeof model.slug === 'string' && typeof model.displayName === 'string';
}

export async function loadChatGPTModels(baseUrl: string, fetcher: typeof fetch): Promise<ChatGPTAccountModel[]> {
  const response = await fetcher(new URL('/chatgpt/models', baseUrl));
  if (!response.ok) return [];
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || !('models' in data) || !Array.isArray(data.models)) return [];
  return (data.models as unknown[]).filter(isModel).map(model => ({id: model.slug, slug: model.slug,
    displayName: model.displayName, ...(model.contextWindow === undefined ? {} : {contextWindow: model.contextWindow}),
    ...(Array.isArray(model.supportedEffortLevels) ? {supportedEffortLevels: chatGPTSupportedEfforts(model.slug, model.supportedEffortLevels)} : {})}));
}

export async function saveOpenAIApiKey(baseUrl: string, fetcher: typeof fetch, apiKey: string): Promise<{revoked: boolean}> {
  return request({baseUrl, fetcher, method: 'POST', pathname: '/openai/api-key', body: {apiKey}});
}

export async function loadChatGPTAccounts(baseUrl: string, fetcher: typeof fetch): Promise<ChatGPTAccount[]> {
  const status = await request<Status>({baseUrl, fetcher, method: 'GET', pathname: '/chatgpt/status'});
  return status.profiles.filter(profile => profile.connected);
}

export async function chatgptCommand(client: ChatGPTClient, command: string, profileId?: string, signal?: AbortSignal): Promise<string> {
  if (command === 'status') {
    const status = await request<Status>({...client, method: 'GET', pathname: '/chatgpt/status', signal});
    if (status.profiles.length === 0) return 'No ChatGPT account connected. Use /chatgpt login.';
    return status.profiles.map(profile => {
      let state = 'plan permission missing';
      if (!profile.connected) state = 'signed out';
      else if (profile.sharing) state = 'plan enabled';
      return `${profile.id === status.selectedId ? '●' : '○'} ${profile.email ?? profile.id} (${state}) · ${profile.id}`;
    }).join('\n');
  }
  if (command === 'login') {
    const status = await request<Status>({...client, method: 'POST', pathname: '/chatgpt/login', body: {profileId}, signal});
    return `Connected ${status.profiles.find(profile => profile.id === status.selectedId)?.email ?? 'ChatGPT account'}.`;
  }
  if (command === 'logout') {
    const result = await request<{revoked: boolean}>({...client, method: 'POST', pathname: '/chatgpt/logout', body: {profileId}, signal});
    return result.revoked ? 'Signed out of ChatGPT.' : 'Local ChatGPT tokens removed; remote revocation could not be confirmed. You can disconnect the app in ChatGPT Settings.';
  }
  if (command === 'use' && profileId !== undefined) {
    await request<Status>({...client, method: 'POST', pathname: '/chatgpt/select', body: {profileId}, signal});
    return 'ChatGPT account selected.';
  }
  throw new Error('Use /chatgpt login [new|profile-id], /chatgpt status, /chatgpt logout, or /chatgpt use <profile-id>.');
}

async function request<T>(options: ChatGPTClient & {method: string; pathname: string; body?: unknown; signal?: AbortSignal}): Promise<T> {
  const response = await options.fetcher(new URL(options.pathname, options.baseUrl), {method: options.method, signal: options.signal,
    ...(options.body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(options.body)})});
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string' ? data.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}
