interface StreamEvent {type: string}

/** Shared Zod schemas satisfy this interface without coupling the reader to Zod. */
interface EventSchema<TEvent> {
	parse(value: unknown): TEvent;
	safeParse(value: unknown): {success: true; data: TEvent} | {success: false};
}

interface StreamContract<TEvent> {
	schema: EventSchema<TEvent>;
	operation: 'chat' | 'compaction';
}

function parseFrame<TEvent>(frame: string, contract: StreamContract<TEvent>): TEvent | undefined {
	const data = frame.split(/\r?\n/)
		.filter(line => line.startsWith('data:'))
		.map(line => line.slice(5).replace(/^ /, ''))
		.join('\n');
	if (!data) return undefined;

	try {
		return contract.schema.parse(JSON.parse(data));
	} catch {
		throw new Error(`The ${contract.operation} server sent an invalid response.`);
	}
}

/** Reads complete SSE frames even when network chunks split JSON or UTF-8 characters. */
export async function* requestEventStream<TEvent extends StreamEvent>(
	url: string,
	request: unknown,
	signal: AbortSignal,
	fetchResponse: typeof fetch,
	contract: StreamContract<TEvent>,
): AsyncGenerator<TEvent> {
	const {operation, schema} = contract;
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
		throw new Error(`Could not reach the ${operation} server. Restart the CLI and try again.`);
	}
	if (signal.aborted) {
		await response.body?.cancel().catch(() => {});
		signal.throwIfAborted();
	}

	if (!response.ok) {
		const event = schema.safeParse(await response.json().catch(() => undefined));
		signal.throwIfAborted();
		if (event.success && event.data.type === 'error') {
			yield event.data;
			return;
		}
		throw new Error(`The ${operation} request failed (HTTP ${response.status}).`);
	}

	const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
	if (contentType !== 'text/event-stream' || !response.body) {
		await response.body?.cancel();
		throw new Error(`The ${operation} server did not return an event stream.`);
	}

	const reader = response.body.getReader();
	const cancelReader = () => {void reader.cancel().catch(() => {});};
	signal.addEventListener('abort', cancelReader, {once: true});
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
				throw new Error(`The ${operation} response was interrupted. Try again.`);
			}
			signal.throwIfAborted();
			buffer += decoder.decode(chunk.value, {stream: !chunk.done});
			let boundary: RegExpExecArray | null;
			while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
				signal.throwIfAborted();
				const frame = buffer.slice(0, boundary.index);
				buffer = buffer.slice(boundary.index + boundary[0].length);
				const event = parseFrame(frame, contract);
				if (!event) continue;
				yield event;
				if (event.type === 'done' || event.type === 'error') return;
			}
			if (chunk.done) throw new Error(`The ${operation} response was interrupted. Try again.`);
		}
	} finally {
		signal.removeEventListener('abort', cancelReader);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
