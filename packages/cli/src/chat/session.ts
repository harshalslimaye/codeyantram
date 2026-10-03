import {randomUUID} from 'node:crypto';
import {toRequestMessage, type AssistantMessage, type ChatMessage, type ChatRequest, type ChatStreamEvent, type EffortLevel} from '@codeyantram/shared';

export type ChatTransport = (request: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatStreamEvent>;

export interface ChatSnapshot {
	messages: ChatMessage[];
	isStreaming: boolean;
	error?: string;
	notice?: string;
}

export class ChatSession {
	private state: ChatSnapshot = {messages: [], isStreaming: false};
	private listeners = new Set<() => void>();
	private controller?: AbortController;

	constructor(private readonly transport: ChatTransport) {}

	getSnapshot = (): ChatSnapshot => this.state;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {this.listeners.delete(listener);};
	};

	private update(changes: Partial<ChatSnapshot>) {
		this.state = {...this.state, ...changes};
		for (const listener of this.listeners) listener();
	}

	cancel() {
		this.controller?.abort();
	}

	clear() {
		this.cancel();
		this.controller = undefined;
		this.update({messages: [], isStreaming: false, error: undefined, notice: undefined});
	}

	async send(text: string, model: string, effort?: EffortLevel): Promise<void> {
		if (this.controller || !text.trim()) return;
		const controller = new AbortController();
		this.controller = controller;
		const userMessage: ChatMessage = {
			id: randomUUID(), role: 'user', parts: [{type: 'text', text: text.trim()}],
		};
		const messages = [...this.state.messages, userMessage];
		const request: ChatRequest = {
			model, effort,
			// Empty placeholders from failed or cancelled turns are not conversation history.
			messages: messages.filter(message => message.parts.length > 0).map(toRequestMessage),
		};
		let assistantId: string = randomUUID();
		this.update({
			messages: [...messages, {id: assistantId, role: 'assistant', parts: []}],
			isStreaming: true, error: undefined, notice: undefined,
		});

		const updateAssistant = (change: (message: AssistantMessage) => AssistantMessage) => {
			this.update({messages: this.state.messages.map(message =>
				message.id === assistantId && message.role === 'assistant' ? change(message) : message,
			)});
		};

		try {
			let terminal = false;
			for await (const event of this.transport(request, controller.signal)) {
				controller.signal.throwIfAborted();
				if (event.type === 'start') {
					updateAssistant(message => ({...message, id: event.messageId}));
					assistantId = event.messageId;
				} else if (event.type === 'text-delta') {
					updateAssistant(message => ({...message, parts: [{
						type: 'text', text: message.parts.map(part => part.text).join('') + event.text,
					}]}));
				} else if (event.type === 'done') {
					updateAssistant(message => ({...message, usage: event.usage}));
					terminal = true;
					break;
				} else if (event.type === 'error') {
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
			if (controller.signal.aborted) {
				this.update({notice: 'Generation cancelled. Partial text has been kept.'});
			} else {
				this.update({error: error instanceof Error ? error.message : 'The chat request failed. Try again.'});
			}
		} finally {
			if (this.controller === controller) {
				this.controller = undefined;
				this.update({isStreaming: false});
			}
		}
	}
}
