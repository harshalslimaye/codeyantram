import {performance} from 'node:perf_hooks';
import {NoSuchToolError, InvalidToolInputError, type TextStreamPart, type ToolSet} from 'ai';
import {toolCallSchema, toolResultSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {ChatError, toChatErrorEvent} from './errors.js';
import {toTokenUsage} from './usage.js';

type Part = TextStreamPart<ToolSet>;

function toolErrorCode(error: unknown): 'tool_not_found' | 'invalid_input' | 'execution_failed' {
  if (NoSuchToolError.isInstance(error)) return 'tool_not_found';
  if (InvalidToolInputError.isInstance(error)) return 'invalid_input';
  return 'execution_failed';
}

function toolCallEvent(part: Extract<Part, {type: 'tool-call'}>, invalidCalls: Map<string, unknown>): ChatStreamEvent {
  if ('invalid' in part && part.invalid === true && 'error' in part) invalidCalls.set(part.toolCallId, part.error);
  const rawInput: unknown = part.input;
  const input = typeof rawInput === 'object' && rawInput !== null && !Array.isArray(rawInput) ? rawInput : {};
  return {type: 'tool-call', call: toolCallSchema.parse({toolCallId: part.toolCallId, toolName: part.toolName, input,
    ...(part.providerMetadata ? {providerOptions: JSON.parse(JSON.stringify(part.providerMetadata)) as unknown} : {})})};
}

function finishEvent(part: Extract<Part, {type: 'finish'}>, startedAt: number): ChatStreamEvent {
  if (part.finishReason === 'tool-calls') throw new ChatError('tool_limit', 'The tool step limit was reached. Narrow the question or continue in another turn.');
  if (part.finishReason === 'error' || part.finishReason === 'other') {
    throw new ChatError('provider_error', 'The provider response ended without completing.');
  }
  const usage = toTokenUsage(part.totalUsage);
  return {type: 'done', durationMs: performance.now() - startedAt, ...(usage === undefined ? {} : {usage})};
}

function toEvent(part: Part, invalidCalls: Map<string, unknown>, startedAt: number): ChatStreamEvent | undefined {

  if (part.type === 'text-delta') return {type: 'text-delta', text: part.text};
  if (part.type === 'tool-call') return toolCallEvent(part, invalidCalls);
  if (part.type === 'tool-result') return {type: 'tool-result', result: toolResultSchema.parse(part.output)};
  if (part.type === 'tool-error') {
      const error = invalidCalls.get(part.toolCallId) ?? part.error;
      invalidCalls.delete(part.toolCallId);
      return {type: 'tool-result', result: {toolCallId: part.toolCallId, toolName: part.toolName, status: 'error', error: {
        code: toolErrorCode(error), message: 'The tool call could not be executed. Use an available tool with valid arguments.',
      }}};
    }
  if (part.type === 'error') return toChatErrorEvent(part.error, 'provider_error');
  if (part.type === 'finish') return finishEvent(part, startedAt);
  return;
}

export async function* translateProviderEvents(stream: AsyncIterable<Part>, signal: AbortSignal, startedAt: number): AsyncGenerator<ChatStreamEvent> {
  const invalidCalls = new Map<string, unknown>();
  for await (const part of stream) {
    if (signal.aborted || part.type === 'abort') return;
    const event = toEvent(part, invalidCalls, startedAt);
    if (event) yield event;
    if (part.type === 'error' || part.type === 'finish') return;
  }
  if (!signal.aborted) throw new ChatError('provider_error', 'The provider response ended without completing.');
}
