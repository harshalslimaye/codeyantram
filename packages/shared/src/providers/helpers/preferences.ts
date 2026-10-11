import {
	DEFAULT_CHAT_MODEL_ID,
	EFFORT_LEVELS,
	findSupportedChatModel,
	isChatGPTModelId,
	isOpenAIModelSlug,
	modelSupportsEffort,
	type EffortLevel,
} from '../config/index.js';
import {readConfig, writeConfig} from '../../filesystem/config.js';
import {chatGPTConnectionConfig, openAIConnection, type OpenAIConnection} from './connection.js';

export interface ModelPreferences {
	modelId: string;
	openaiConnection?: OpenAIConnection;
	effortByModel: Record<string, EffortLevel>;
}

export function resolveModelPreferences(config: Record<string, unknown>): ModelPreferences {
	const openaiConnection = openAIConnection(config);
	const savedId = typeof config.model === 'string' ? config.model : '';
	const modelId = isChatGPTModelId(savedId) ? savedId.slice('chatgpt:'.length) : savedId;
	const model = findSupportedChatModel(modelId);
	const effortByModel = resolveSavedEfforts(config.effortByModel, openaiConnection);
	const hasConnectionChoice = config.openaiConnection === 'chatgpt' || config.openaiConnection === 'api-key' || isChatGPTModelId(savedId);
	return {modelId: model?.id ?? (openaiConnection === 'chatgpt' && isOpenAIModelSlug(modelId) ? modelId : DEFAULT_CHAT_MODEL_ID),
		...(hasConnectionChoice ? {openaiConnection} : {}), effortByModel};
}

export async function readModelPreferences(): Promise<ModelPreferences> {
	try {
		return resolveModelPreferences(await readConfig());
	} catch {
		return resolveModelPreferences({});
	}
}

// oxlint-disable-next-line eslint/complexity -- Saved account models and built-in provider models have different validation rules.
export async function saveModelPreference(id: string, effort?: EffortLevel): Promise<ModelPreferences> {
	const model = findSupportedChatModel(id);
	if (!model && !isOpenAIModelSlug(id)) throw new Error(`Model "${id}" is not available.`);
	if (effort !== undefined && model !== undefined && model.provider !== 'openai' && !modelSupportsEffort(model, effort)) {
		throw new Error(`Model "${id}" does not support effort "${effort}".`);
	}
	const config = await readConfig();
	const connection = openAIConnection(config);
	if (!model && !(connection === 'chatgpt' && isOpenAIModelSlug(id))) throw new Error(`Model "${id}" is not available.`);
	if (effort !== undefined && !(connection === 'chatgpt' && (model?.provider === 'openai' || !model)) && (!model || !modelSupportsEffort(model, effort))) {
		throw new Error(`Model "${id}" does not support effort "${effort}".`);
	}
	const {effortByModel} = resolveModelPreferences(config);
	if (effort !== undefined) effortByModel[id] = effort; // oxlint-disable-line security/detect-object-injection -- Model IDs are validated against the supported model registry before writing preferences.
	const hasConnectionChoice = config.openaiConnection !== undefined || (typeof config.model === 'string' && isChatGPTModelId(config.model));
	const nextConfig = connection === 'chatgpt' ? chatGPTConnectionConfig(config) : config;
	await writeConfig({...nextConfig, model: id, effortByModel,
		...(hasConnectionChoice ? {openaiConnection: connection} : {})});
	return {modelId: model?.id ?? id, ...(hasConnectionChoice ? {openaiConnection: connection} : {}), effortByModel};
}

// oxlint-disable-next-line eslint/complexity -- Saved efforts are retained only for valid built-in or account-discovered models.
function resolveSavedEfforts(savedEfforts: unknown, connection: OpenAIConnection): Record<string, EffortLevel> {
	const effortByModel: Record<string, EffortLevel> = {};
	if (typeof savedEfforts === 'object' && savedEfforts !== null && !Array.isArray(savedEfforts)) {
		for (const [id, value] of Object.entries(savedEfforts)) {
			const savedModel = findSupportedChatModel(id);
			const effort = EFFORT_LEVELS.find(level => level === value);
			if (effort && ((savedModel && modelSupportsEffort(savedModel, effort)) ||
				(connection === 'chatgpt' && (savedModel?.provider === 'openai' || savedModel === undefined) && isOpenAIModelSlug(id)))) {
				effortByModel[id] = effort; // oxlint-disable-line security/detect-object-injection -- Model IDs are validated against the supported model registry before writing preferences.
			}
		}
	}
	return effortByModel;
}
