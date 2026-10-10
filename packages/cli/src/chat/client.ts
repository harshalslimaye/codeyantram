import {
	chatStreamEventSchema,
	compactStreamEventSchema,
	type ChatRequest,
	type ChatStreamEvent,
	type CompactRequest,
	type CompactStreamEvent,
} from '@codeyantram/shared';
import {requestEventStream} from './sse.js';

export async function* requestChat(
	url: string,
	request: ChatRequest,
	signal: AbortSignal,
	fetchResponse: typeof fetch = fetch,
): AsyncGenerator<ChatStreamEvent> {
	yield* requestEventStream(url, request, signal, {
		fetchResponse,
		contract: {schema: chatStreamEventSchema, operation: 'chat'},
	});
}

/** Only a complete, schema-valid done event exposes a usable summary. */
export async function* requestCompact(
	url: string,
	request: CompactRequest,
	signal: AbortSignal,
	fetchResponse: typeof fetch = fetch,
): AsyncGenerator<CompactStreamEvent> {
	yield* requestEventStream(url, request, signal, {
		fetchResponse,
		contract: {schema: compactStreamEventSchema, operation: 'compaction'},
	});
}
