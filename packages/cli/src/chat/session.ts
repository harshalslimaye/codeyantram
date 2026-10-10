import {randomUUID} from 'node:crypto';
import type {ChatTransport, CompactTransport, InitTransport, CompactionState, CompactionOutcome, ChatSnapshot} from './session-types.js';
import {createChatEventHandler} from './chat-events.js';
import {recordCompactionUsage, usageNotice} from './compaction-usage.js';
import {compactionNoopNotice, prepareCompactionRequest, readCompactionResult} from './compaction-stream.js';
import type {ChatRequest, CompactStreamEvent, EffortLevel} from '@codeyantram/shared';
import {buildChatContext, estimateContextTokens, getContextStatus, type ConversationMessage} from './context.js';
import {assessCompactionReduction, planCompaction, type CompactionPlan} from './compaction.js';

export type {ChatTransport, CompactTransport, InitTransport, SessionOperation, CompactionState, CompactionUsage, CompactionOutcome, ChatSnapshot, StatusEntry} from './session-types.js';

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

	private prepareChat(text: string, model: string, effort?: EffortLevel) {
		const userMessage: ConversationMessage = {
			id: randomUUID(), role: 'user', parts: [{type: 'text', text: text.trim()}],
		};
		const messages = [...this.state.messages, userMessage];
		const request: ChatRequest = {
			model, effort,
			...buildChatContext(messages, this.state.compaction),
		};
		return {messages, request};
	}

	async send(text: string, model: string, effort?: EffortLevel): Promise<void> {
		if (this.controller || !text.trim()) return;
		const controller = new AbortController();
		const {messages, request} = this.prepareChat(text, model, effort);
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
			const handleEvent = createChatEventHandler({
				getMessages: () => this.state.messages, updateAssistant,
				setAssistantId: id => {assistantId = id;},
				updateError: error => {this.update({error});},
			});
			if (this.controller !== controller) return;
			for await (const event of this.transport(request, controller.signal)) {
				if (this.controller !== controller) return;
				controller.signal.throwIfAborted();
				terminal = handleEvent(event);
				if (terminal) break;
			}
			controller.signal.throwIfAborted();
			if (!terminal) throw new Error('The chat response was interrupted. Try again.');
		} catch (error) {
			this.handleChatFailure(error, controller, updateAssistant);
		} finally {
			this.finishOperation(controller);
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
				const notice = compactionNoopNotice(plan.reason);
				this.update({notice, error: undefined});
				return plan;
			}
			if (!this.compactTransport) throw new Error('Conversation compaction is unavailable.');
			const request = prepareCompactionRequest(model, plan);
			const before = buildChatContext(transcript, previous);
			const replaced = buildChatContext(transcript.slice(0, plan.coveredMessageCount), previous);
			controller = new AbortController();
			this.controller = controller;
			revision = this.revision;
			this.update({operation: 'compact', notice: undefined, error: undefined});
			if (this.compactionCancelled(controller, revision)) return {type: 'cancelled'};

			const result = await readCompactionResult(this.compactTransport(request, controller.signal),
				() => this.compactionCancelled(controller, revision));
			// Breaking the loop waits for transport cleanup before any context commit.
			if (this.compactionCancelled(controller, revision)) return {type: 'cancelled'};
			if (!result) throw new Error('The compaction response was interrupted. Try again.');
			return this.commitCompaction({result, plan, previous, transcript, model: request.model, before, replaced});
		} catch (error) {
			return this.handleCompactionFailure(error, controller, revision);
		} finally {
			if (controller) this.finishOperation(controller);
		}
	}

	private compactionCancelled(controller: AbortController | undefined, revision: number): boolean {
		return this.controller !== controller || this.revision !== revision || controller?.signal.aborted === true;
	}

	private commitCompaction(context: {
		result: Extract<CompactStreamEvent, {type: 'done'}>; plan: Extract<CompactionPlan, {type: 'ready'}>;
		previous: CompactionState | undefined; transcript: ConversationMessage[]; model: string;
		before: ReturnType<typeof buildChatContext>; replaced: ReturnType<typeof buildChatContext>;
	}): CompactionOutcome {
		const {result, plan, previous, transcript, model, before, replaced} = context;
		const candidate: CompactionState = {
			summary: result.summary, coveredMessageCount: plan.coveredMessageCount,
			generation: (previous?.generation ?? 0) + 1, model,
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
	}

	private handleChatFailure(error: unknown, controller: AbortController, updateAssistant: (change: (message: Extract<ConversationMessage, {role: 'assistant'}>) => Extract<ConversationMessage, {role: 'assistant'}>) => void) {
		if (this.controller !== controller) return;
		updateAssistant(message => ({...message, status: controller.signal.aborted ? 'cancelled' : 'failed'}));
		if (controller.signal.aborted) {
			this.update({notice: 'Generation cancelled. Partial text has been kept.'});
		} else {
			this.update({error: error instanceof Error ? error.message : 'The chat request failed. Try again.'});
		}
	}

	private handleCompactionFailure(error: unknown, controller: AbortController | undefined, revision: number): CompactionOutcome {
		if (controller && this.compactionCancelled(controller, revision)) return {type: 'cancelled'};
		const message = error instanceof Error ? error.message : 'The compaction request failed. Try again.';
		this.update({error: message, notice: undefined});
		return {type: 'failed', message};
	}

	private finishOperation(controller: AbortController) {
		if (this.controller === controller) {
			this.controller = undefined;
			this.update({operation: 'idle'});
			controller.abort();
		}
	}
}
