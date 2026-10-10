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
		.map(line => line.slice('data:'.length).replace(/^ /, ''))
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
	options: {fetchResponse: typeof fetch; contract: StreamContract<TEvent>},
): AsyncGenerator<TEvent> {
	const {contract} = options;
	const {operation, schema} = contract;
	signal.throwIfAborted();
	const response = await postRequest(url, request, signal, options);
	if (signal.aborted) {
		await response.body?.cancel().catch(() => {});
		signal.throwIfAborted();
	}

	if (!response.ok) {
		const event = schema.safeParse(await response.json().catch(() => {}));
		signal.throwIfAborted();
		if (event.success && event.data.type === 'error') {
			yield event.data;
			return;
		}
		throw new Error(`The ${operation} request failed (HTTP ${response.status}).`);
	}

	const body = await eventBody(response, operation);
	yield* readEvents(body, signal, contract);
}

async function postRequest<TEvent>(url: string, request: unknown, signal: AbortSignal, options: {fetchResponse: typeof fetch; contract: StreamContract<TEvent>}): Promise<Response> {
	const {fetchResponse, contract: {operation}} = options;
	try {
		return await fetchResponse(url, {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify(request),
			signal,
		});
	} catch {
		signal.throwIfAborted();
		throw new Error(`Could not reach the ${operation} server. Restart the CLI and try again.`);
	}
}

async function* readEvents<TEvent extends StreamEvent>(body: ReadableStream<Uint8Array>, signal: AbortSignal, contract: StreamContract<TEvent>): AsyncGenerator<TEvent> {
	const {operation} = contract;
	const reader = body.getReader();
	const cancelReader = () => {void reader.cancel().catch(() => {});};
	signal.addEventListener('abort', cancelReader, {once: true});
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			signal.throwIfAborted();
			const chunk = await readChunk(reader, signal, operation);
			signal.throwIfAborted();
			buffer += decoder.decode(chunk.value, {stream: !chunk.done});
			const frames = yield* emitFrames(buffer, signal, contract);
			if (frames.terminal) return;
			buffer = frames.buffer;
			if (chunk.done) throw new Error(`The ${operation} response was interrupted. Try again.`);
		}
	} finally {
		signal.removeEventListener('abort', cancelReader);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal, operation: string) {
	try {
		return await reader.read();
	} catch {
		signal.throwIfAborted();
		throw new Error(`The ${operation} response was interrupted. Try again.`);
	}
}

function isTerminal(event: StreamEvent): boolean {
	return event.type === 'done' || event.type === 'error';
}

function* parseEvents<TEvent extends StreamEvent>(input: string, signal: AbortSignal, contract: StreamContract<TEvent>): Generator<TEvent, string> {
	let buffer = input;
	let boundary: RegExpExecArray | null;
	while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
		signal.throwIfAborted();
		const frame = buffer.slice(0, boundary.index);
		buffer = buffer.slice(boundary.index + boundary[0].length);
		const event = parseFrame(frame, contract);
		if (event !== undefined) yield event;
	}
	return buffer;
}

async function eventBody(response: Response, operation: string): Promise<ReadableStream<Uint8Array>> {
	const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
	if (contentType !== 'text/event-stream' || !response.body) {
		await response.body?.cancel();
		throw new Error(`The ${operation} server did not return an event stream.`);
	}

	return response.body;
}

function* emitFrames<TEvent extends StreamEvent>(buffer: string, signal: AbortSignal, contract: StreamContract<TEvent>): Generator<TEvent, {terminal: boolean; buffer: string}> {
	const frames = parseEvents(buffer, signal, contract);
	let frame = frames.next();
	while (frame.done !== true) {
		yield frame.value;
		if (isTerminal(frame.value)) return {terminal: true, buffer: ''};
		frame = frames.next();
	}
	return {terminal: false, buffer: frame.value};
}
