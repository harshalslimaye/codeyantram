import type {ChatRequest, ChatStreamEvent, CompactRequest, CompactStreamEvent, TokenUsage} from '@codeyantram/shared';
import type {CompactedContext, ContextStatus, ConversationMessage} from './context.js';
import type {CompactionPlan} from './compaction.js';

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

