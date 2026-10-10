import {compactRequestSchema, compactStreamEventSchema, type CompactStreamEvent} from '@codeyantram/shared';
import {getCompactionSizeError, type CompactionPlan} from './compaction.js';

export function compactionNoopNotice(reason: Extract<CompactionPlan, {type: 'noop'}>['reason']): string {
  if (reason === 'prefix-too-small') return 'Older conversation context is too small to compact.';
  if (reason === 'streaming') return 'Wait for generation to finish before compacting.';
  return 'No older conversation turns are available to compact; latest 2 turns are kept.';
}

export function prepareCompactionRequest(model: string, plan: Extract<CompactionPlan, {type: 'ready'}>) {
	const parsed = compactRequestSchema.safeParse({
		model, messages: plan.messages,
		...(plan.previousSummary === undefined ? {} : {previousSummary: plan.previousSummary}),
	});
	if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid compaction request.');
	const sizeError = getCompactionSizeError(parsed.data);
	if (sizeError !== undefined && sizeError !== '') throw new Error(sizeError);
	return parsed.data;
}

export async function readCompactionResult(events: AsyncIterable<CompactStreamEvent>, isCancelled: () => boolean) {
	let result: Extract<CompactStreamEvent, {type: 'done'}> | undefined;
	for await (const rawEvent of events) {
		if (isCancelled()) return;
		const parsedEvent = compactStreamEventSchema.safeParse(rawEvent);
		if (!parsedEvent.success) throw new Error('The compaction server sent an invalid response.');
		const event = parsedEvent.data;
		if (event.type === 'start') continue;
		if (event.type === 'error') {
			const hint = event.code === 'missing_credentials' ? ' Use /connect to configure an API key.' : '';
			throw new Error(event.message + hint);
		}
		result = event;
		break;
	}
	return result;
}
