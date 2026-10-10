import {
	DEFAULT_CHAT_MODEL_ID,
	EFFORT_LEVELS,
	findSupportedChatModel,
	modelSupportsEffort,
	type EffortLevel,
	type SupportedChatModelId,
} from '../config/index.js';
import {readConfig, writeConfig} from '../../filesystem/config.js';

export interface ModelPreferences {
	modelId: SupportedChatModelId;
	effortByModel: Record<string, EffortLevel>;
}

export function resolveModelPreferences(config: Record<string, unknown>): ModelPreferences {
	const model = typeof config.model === 'string' ? findSupportedChatModel(config.model) : undefined;
	const effortByModel = resolveSavedEfforts(config.effortByModel);
	return {modelId: model?.id ?? DEFAULT_CHAT_MODEL_ID, effortByModel};
}

export async function readModelPreferences(): Promise<ModelPreferences> {
	try {
		return resolveModelPreferences(await readConfig());
	} catch {
		return resolveModelPreferences({});
	}
}

export async function saveModelPreference(id: string, effort?: EffortLevel): Promise<ModelPreferences> {
	const model = findSupportedChatModel(id);
	if (!model) throw new Error(`Model "${id}" is not available.`);
	if (effort !== undefined && !modelSupportsEffort(model, effort)) {
		throw new Error(`Model "${id}" does not support effort "${effort}".`);
	}
	const config = await readConfig();
	const {effortByModel} = resolveModelPreferences(config);
	if (effort !== undefined) effortByModel[id] = effort; // oxlint-disable-line security/detect-object-injection -- Model IDs are validated against the supported model registry before writing preferences.
	await writeConfig({...config, model: id, effortByModel});
	return {modelId: model.id, effortByModel};
}

function resolveSavedEfforts(savedEfforts: unknown): Record<string, EffortLevel> {
	const effortByModel: Record<string, EffortLevel> = {};
	if (typeof savedEfforts === 'object' && savedEfforts !== null && !Array.isArray(savedEfforts)) {
		for (const [id, value] of Object.entries(savedEfforts)) {
			const savedModel = findSupportedChatModel(id);
			const effort = EFFORT_LEVELS.find(level => level === value);
			if (savedModel && effort && modelSupportsEffort(savedModel, effort)) {
				effortByModel[id] = effort; // oxlint-disable-line security/detect-object-injection -- Model IDs are validated against the supported model registry before writing preferences.
			}
		}
	}
	return effortByModel;
}
