import {chatStreamEventSchema, type ChatRequest, type ChatStreamEvent} from '@codeyantram/shared';

function parseFrame(frame: string): ChatStreamEvent | undefined {
	const data = frame.split(/\r?\n/)
		.filter(line => line.startsWith('data:'))
		.map(line => line.slice(5).replace(/^ /, ''))
		.join('\n');
	if (!data) return undefined;

	try {
		return chatStreamEventSchema.parse(JSON.parse(data));
	} catch {
		throw new Error('The chat server sent an invalid response.');
	}
}

/** Reads complete SSE frames even when network chunks split JSON or UTF-8 characters. */
export async function* requestChat(
	url: string,
	request: ChatRequest,
	signal: AbortSignal,
	fetchResponse: typeof fetch = fetch,
): AsyncGenerator<ChatStreamEvent> {
	signal.throwIfAborted();
	let response: Response;
	try {
		response = await fetchResponse(url, {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify(request),
			signal,
		});
	} catch {
		signal.throwIfAborted();
		throw new Error('Could not reach the chat server. Restart the CLI and try again.');
	}

	if (!response.ok) {
		const event = chatStreamEventSchema.safeParse(await response.json().catch(() => undefined));
		if (event.success && event.data.type === 'error') {
			yield event.data;
			return;
		}
		throw new Error(`The chat request failed (HTTP ${response.status}).`);
	}

	const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
	if (contentType !== 'text/event-stream' || !response.body) {
		await response.body?.cancel();
		throw new Error('The chat server did not return an event stream.');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			signal.throwIfAborted();
			let chunk: ReadableStreamReadResult<Uint8Array>;
			try {
				chunk = await reader.read();
			} catch {
				signal.throwIfAborted();
				throw new Error('The chat response was interrupted. Try again.');
			}
			buffer += decoder.decode(chunk.value, {stream: !chunk.done});
			let boundary: RegExpExecArray | null;
			while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
				signal.throwIfAborted();
				const frame = buffer.slice(0, boundary.index);
				buffer = buffer.slice(boundary.index + boundary[0].length);
				const event = parseFrame(frame);
				if (!event) continue;
				yield event;
				if (event.type === 'done' || event.type === 'error') return;
			}
			if (chunk.done) throw new Error('The chat response was interrupted. Try again.');
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
