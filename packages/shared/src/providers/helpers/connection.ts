import {readConfig, writeConfig} from '../../filesystem/config.js';
import {asObject} from '../../utils/objects.js';
import {findSupportedChatModel, isOpenAIModelSlug} from '../config/index.js';

export type OpenAIConnection = 'api-key' | 'chatgpt';

export function openAIConnection(config: Record<string, unknown>): OpenAIConnection {
	if (config.openaiConnection === 'chatgpt' || config.openaiConnection === 'api-key') return config.openaiConnection;
	return typeof config.model === 'string' && config.model.startsWith('chatgpt:') ? 'chatgpt' : 'api-key';
}

export function usesChatGPTConnection(config: Record<string, unknown>, modelId: string): boolean {
	if (openAIConnection(config) !== 'chatgpt') return false;
	const model = findSupportedChatModel(modelId);
	return model?.provider === 'openai' || (model === undefined && isOpenAIModelSlug(modelId));
}

/** A successful ChatGPT sign-in removes the OpenAI API key from user config. */
export function chatGPTConnectionConfig(config: Record<string, unknown>): Record<string, unknown> {
	const providers = {...asObject(config.providers)};
	const openai = {...asObject(providers.openai)};
	delete openai.apiKey;
	providers.openai = openai;
	return {...config, providers, openaiConnection: 'chatgpt',
		...(typeof config.model === 'string' && config.model.startsWith('chatgpt:') ? {model: config.model.slice('chatgpt:'.length)} : {})};
}

export async function selectChatGPTConnection(): Promise<void> {
	await writeConfig(chatGPTConnectionConfig(await readConfig()));
}
