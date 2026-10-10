import type {TokenUsage} from '@codeyantram/shared';
import type {CompactionUsage} from './session.js';

const usageFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const;
const usageLabels = {inputTokens: 'input', outputTokens: 'output', totalTokens: 'total', cacheReadTokens: 'cache read', cacheWriteTokens: 'cache write'};

export function recordCompactionUsage(previous: CompactionUsage | undefined, usage?: TokenUsage): CompactionUsage {
	const tokens = {...previous?.tokens};
	let reported = false;
	for (const field of usageFields) {
		if (usage?.[field] !== undefined) {
			tokens[field] = (tokens[field] ?? 0) + usage[field];
			reported = true;
		}
	}
	return {
		completedCalls: (previous?.completedCalls ?? 0) + 1,
		callsWithUsage: (previous?.callsWithUsage ?? 0) + Number(reported),
		tokens,
	};
}

export function usageNotice(usage?: TokenUsage): string {
	const fields = usageFields.filter(field => usage?.[field] !== undefined);
	return fields.length ? ` Available compaction usage: ${fields.map(field => `${usageLabels[field]} ${usage?.[field]} tokens`).join(', ')}.`
		: ' Compaction usage unavailable.';
}

