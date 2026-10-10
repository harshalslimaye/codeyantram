import {randomUUID} from 'node:crypto';
import {
	compactRequestSchema,
	compactStreamEventSchema,
	type ChatRequest,
	type ChatStreamEvent,
	type CompactRequest,
	type CompactStreamEvent,
	type EffortLevel,
	type TokenUsage,
	toolCallSchema, toolResultSchema,
} from '@codeyantram/shared';
import {buildChatContext, estimateContextTokens, getContextStatus, type ContextStatus, type CompactedContext, type ConversationMessage} from './context.js';
import {assessCompactionReduction, getCompactionSizeError, planCompaction, type CompactionPlan} from './compaction.js';

export type ChatTransport = (request: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatStreamEvent>;
export type CompactTransport = (request: CompactRequest, signal: AbortSignal) => AsyncIterable<CompactStreamEvent>;
export type InitTransport = (signal: AbortSignal, onProgress: (message: string) => void) => Promise<string>;
export type SessionOperation = 'idle' | 'chat' | 'compact' | 'init';

export interface CompactionState extends CompactedContext {
	generation: number;
	model: string;
	usage?: TokenUsage;
	durationMs: number;
}

/** Totals sum only reported fields; missing usage never becomes a measured zero. */
export interface CompactionUsage {
	completedCalls: number;
	callsWithUsage: number;
	tokens: TokenUsage;
}

export type CompactionOutcome =
	| {type: 'success'}
	| {type: 'busy'}
	| {type: 'noop'; reason: Extract<CompactionPlan, {type: 'noop'}>['reason'] | 'insufficient-reduction'}
	| {type: 'cancelled'}
	| {type: 'failed'; message: string};

const usageFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const;
const usageLabels = {inputTokens: 'input', outputTokens: 'output', totalTokens: 'total', cacheReadTokens: 'cache read', cacheWriteTokens: 'cache write'};

function recordCompactionUsage(previous: CompactionUsage | undefined, usage?: TokenUsage): CompactionUsage {
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

function usageNotice(usage?: TokenUsage): string {
	const fields = usageFields.filter(field => usage?.[field] !== undefined);
	return fields.length ? ` Available compaction usage: ${fields.map(field => `${usageLabels[field]} ${usage![field]} tokens`).join(', ')}.`
		: ' Compaction usage unavailable.';
}

export interface ChatSnapshot {
	messages: ConversationMessage[];
	statusEntries: StatusEntry[];
	operation: SessionOperation;
	isStreaming: boolean;
	compaction?: CompactionState;
	compactionUsage?: CompactionUsage;
	error?: string;
	notice?: string;
}

/** UI-only snapshots anchored between transcript messages; never sent to a provider. */
export interface StatusEntry {
	id: string;
	afterMessageCount: number;
	status: ContextStatus;
}

export class ChatSession {
	private state: ChatSnapshot = {messages: [], statusEntries: [], operation: 'idle', isStreaming: false};
	private listeners = new Set<() => void>();
	private controller?: AbortController;
	private revision = 0;

	constructor(
		private readonly transport: ChatTransport,
		private readonly compactTransport?: CompactTransport,
		private readonly initTransport?: InitTransport,
	) {}

	getSnapshot = (): ChatSnapshot => this.state;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {this.listeners.delete(listener);};
	};

	private update(changes: Partial<Omit<ChatSnapshot, 'isStreaming'>>) {
		if (changes.messages !== undefined) this.revision++;
		const next = {...this.state, ...changes};
		this.state = {...next, isStreaming: next.operation === 'chat'};
		for (const listener of this.listeners) listener();
	}

	cancel() {
		const controller = this.controller;
		if (!controller) return;
		if (this.state.operation === 'init') {
			// The graph owns SQLite until initialization and cleanup have drained.
			controller.abort();
			this.update({notice: 'Cancelling graph initialization…'});
			return;
		}
		this.controller = undefined;
		const isChat = this.state.operation === 'chat';
		this.update({
			operation: 'idle', error: undefined,
			notice: isChat ? 'Generation cancelled. Partial text has been kept.' : 'Compaction cancelled. Previous context has been kept.',
			...(isChat ? {messages: this.state.messages.map(message =>
				message.role === 'assistant' && message.status === 'streaming' ? {...message, status: 'cancelled' as const} : message,
			)} : {}),
		});
		controller.abort();
	}

	clear() {
		const controller = this.controller;
		if (this.state.operation === 'init') {
			this.update({messages: [], statusEntries: [], compaction: undefined, compactionUsage: undefined, error: undefined});
			this.cancel();
			return;
		}
		this.controller = undefined;
		this.update({messages: [], statusEntries: [], operation: 'idle', compaction: undefined, compactionUsage: undefined, error: undefined, notice: undefined});
		controller?.abort();
	}

	showStatus(modelId: string) {
		if (this.controller) return;
		this.update({
			statusEntries: [...this.state.statusEntries, {
				id: randomUUID(), afterMessageCount: this.state.messages.length,
				status: getContextStatus(modelId, this.state.messages, this.state.compaction),
			}],
			notice: undefined,
		});
	}

	async initialize(): Promise<void> {
		if (this.controller) return;
		const controller = new AbortController();
		this.controller = controller;
		this.update({operation: 'init', error: undefined, notice: 'Initializing project graph…'});
		try {
			if (!this.initTransport) throw new Error('Graph initialization is unavailable.');
			controller.signal.throwIfAborted();
			const message = await this.initTransport(controller.signal, progress => {
				if (this.controller === controller && !controller.signal.aborted) this.update({notice: progress});
			});
			controller.signal.throwIfAborted();
			this.update({notice: message});
		} catch (error) {
			if (controller.signal.aborted) {
				this.update({notice: 'Graph initialization cancelled. Use /init to retry.', error: undefined});
			} else {
				this.update({error: error instanceof Error ? error.message : 'Graph initialization failed.', notice: undefined});
			}
		} finally {
			this.controller = undefined;
			this.update({operation: 'idle'});
			controller.abort();
		}
	}

	async send(text: string, model: string, effort?: EffortLevel): Promise<void> {
		if (this.controller || !text.trim()) return;
		const controller = new AbortController();
		const userMessage: ConversationMessage = {
			id: randomUUID(), role: 'user', parts: [{type: 'text', text: text.trim()}],
		};
		const messages = [...this.state.messages, userMessage];
		const request: ChatRequest = {
			model, effort,
			...buildChatContext(messages, this.state.compaction),
		};
		this.controller = controller;
		let assistantId: string = randomUUID();
		this.update({
			messages: [...messages, {id: assistantId, role: 'assistant', parts: [], status: 'streaming'}],
			operation: 'chat', error: undefined, notice: undefined,
		});

		const updateAssistant = (change: (message: Extract<ConversationMessage, {role: 'assistant'}>) => Extract<ConversationMessage, {role: 'assistant'}>) => {
			this.update({messages: this.state.messages.map(message =>
				message.id === assistantId && message.role === 'assistant' ? change(message) : message,
			)});
		};

		try {
			let terminal = false;
			const pendingTools = new Map<string, string>();
			if (this.controller !== controller) return;
			for await (const event of this.transport(request, controller.signal)) {
				if (this.controller !== controller) return;
				controller.signal.throwIfAborted();
				if (event.type === 'start') {
					updateAssistant(message => ({...message, id: event.messageId}));
					assistantId = event.messageId;
				} else if (event.type === 'text-delta') {
					updateAssistant(message => {
						const parts = [...message.parts];
						const last = parts.at(-1);
						if (last?.type === 'text') parts[parts.length - 1] = {...last, text: last.text + event.text};
						else parts.push({type: 'text', text: event.text});
						return {...message, parts};
					});
				} else if (event.type === 'tool-call') {
					const call = toolCallSchema.parse(event.call);
					if (pendingTools.has(call.toolCallId) || this.state.messages.some(message => message.parts.some(part => part.type === 'tool-call' && part.call.toolCallId === call.toolCallId))) throw new Error('Duplicate tool call ID.');
					pendingTools.set(call.toolCallId, call.toolName);
					updateAssistant(message => ({...message, parts: [...message.parts, {type: 'tool-call', call}]}));
				} else if (event.type === 'tool-result') {
					const result = toolResultSchema.parse(event.result);
					if (pendingTools.get(result.toolCallId) !== result.toolName) throw new Error('Tool result did not match a pending call.');
					pendingTools.delete(result.toolCallId);
					updateAssistant(message => ({...message, parts: [...message.parts, {type: 'tool-result', result}]}));
				} else if (event.type === 'done') {
					if (pendingTools.size) throw new Error('The chat completed with unresolved tool calls.');
					updateAssistant(message => ({...message, status: 'complete', usage: event.usage}));
					terminal = true;
					break;
				} else if (event.type === 'error') {
					updateAssistant(message => ({...message, status: 'failed'}));
					const hint = event.code === 'missing_credentials' ? ' Use /connect to configure an API key.' : '';
					this.update({error: event.message + hint});
					terminal = true;
					break;
				}
			}
			controller.signal.throwIfAborted();
			if (!terminal) throw new Error('The chat response was interrupted. Try again.');
		} catch (error) {
			if (this.controller !== controller) return;
			updateAssistant(message => ({...message, status: controller.signal.aborted ? 'cancelled' : 'failed'}));
			if (controller.signal.aborted) {
				this.update({notice: 'Generation cancelled. Partial text has been kept.'});
			} else {
				this.update({error: error instanceof Error ? error.message : 'The chat request failed. Try again.'});
			}
		} finally {
			if (this.controller === controller) {
				this.controller = undefined;
				this.update({operation: 'idle'});
				controller.abort();
			}
		}
	}

	async compact(model: string): Promise<CompactionOutcome> {
		if (this.controller) return {type: 'busy'};
		let controller: AbortController | undefined;
		let revision = this.revision;
		try {
			const transcript = this.state.messages;
			const previous = this.state.compaction;
			const plan = planCompaction(transcript, previous);
			if (plan.type === 'noop') {
				const notice = plan.reason === 'prefix-too-small'
					? 'Older conversation context is too small to compact.'
					: plan.reason === 'streaming' ? 'Wait for generation to finish before compacting.'
						: 'No older conversation turns are available to compact; latest 2 turns are kept.';
				this.update({notice, error: undefined});
				return plan;
			}
			if (!this.compactTransport) throw new Error('Conversation compaction is unavailable.');
			const parsed = compactRequestSchema.safeParse({
				model, messages: plan.messages,
				...(plan.previousSummary === undefined ? {} : {previousSummary: plan.previousSummary}),
			});
			if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid compaction request.');
			const sizeError = getCompactionSizeError(parsed.data);
			if (sizeError !== undefined && sizeError !== '') throw new Error(sizeError);
			const before = buildChatContext(transcript, previous);
			const replaced = buildChatContext(transcript.slice(0, plan.coveredMessageCount), previous);
			controller = new AbortController();
			this.controller = controller;
			revision = this.revision;
			this.update({operation: 'compact', notice: undefined, error: undefined});
			if (this.controller !== controller || this.revision !== revision || controller.signal.aborted) return {type: 'cancelled'};

			let result: Extract<CompactStreamEvent, {type: 'done'}> | undefined;
			for await (const rawEvent of this.compactTransport(parsed.data, controller.signal)) {
				if (this.controller !== controller || this.revision !== revision || controller.signal.aborted) return {type: 'cancelled'};
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
			// Breaking the loop waits for transport cleanup before any context commit.
			if (this.controller !== controller || this.revision !== revision || controller.signal.aborted) return {type: 'cancelled'};
			if (!result) throw new Error('The compaction response was interrupted. Try again.');
			const candidate: CompactionState = {
				summary: result.summary, coveredMessageCount: plan.coveredMessageCount,
				generation: (previous?.generation ?? 0) + 1, model: parsed.data.model,
				durationMs: result.durationMs,
				...(result.usage === undefined ? {} : {usage: result.usage}),
			};
			const after = buildChatContext(transcript, candidate);
			const compactionUsage = recordCompactionUsage(this.state.compactionUsage, result.usage);
			if (!assessCompactionReduction(replaced, candidate.summary).sufficient) {
				this.update({compactionUsage, notice: 'The generated summary did not reduce older context by at least 20%. Previous context has been kept.' + usageNotice(result.usage)});
				return {type: 'noop', reason: 'insufficient-reduction'};
			}
			this.update({
				compaction: candidate, compactionUsage,
				notice: `Compacted ${plan.coveredMessageCount - (previous?.coveredMessageCount ?? 0)} messages; latest ${plan.retainedTurnCount} turns kept. `
					+ `Estimated context: ~${estimateContextTokens(before)} → ~${estimateContextTokens(after)} tokens.` + usageNotice(result.usage),
			});
			return {type: 'success'};
		} catch (error) {
			if (controller && (this.controller !== controller || this.revision !== revision || controller.signal.aborted)) return {type: 'cancelled'};
			const message = error instanceof Error ? error.message : 'The compaction request failed. Try again.';
			this.update({error: message, notice: undefined});
			return {type: 'failed', message};
		} finally {
			if (controller && this.controller === controller) {
				this.controller = undefined;
				this.update({operation: 'idle'});
				controller.abort();
			}
		}
	}
}
