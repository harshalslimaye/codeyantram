import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {streamText, type LanguageModelUsage, type ModelMessage} from 'ai';
import {
  chatRequestSchema,
  type ChatRequest,
  type ChatStreamEvent,
  type TokenUsage,
} from '@codeyantram/shared';
import {ChatError, toChatErrorEvent} from './errors.js';
import {resolveChatModel, type ProviderCredentials} from './models.js';

export interface ChatStreamOptions {
  credentials: ProviderCredentials;
  abortSignal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

function toTokenUsage(usage: LanguageModelUsage): TokenUsage | undefined {
  const counts = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
  };
  const entries = Object.entries(counts).filter(([, value]) => value !== undefined);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** Streams the shared chat events; cancellation ends without a terminal event. */
export async function* streamChat(
  request: ChatRequest,
  options: ChatStreamOptions,
): AsyncGenerator<ChatStreamEvent> {
  const controller = new AbortController();
  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, controller.signal])
    : controller.signal;
  const startedAt = performance.now();

  try {
    if (signal.aborted) return;
    yield {type: 'start', messageId: randomUUID()};
    if (signal.aborted) return;

    const parsed = chatRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ChatError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid chat request.');
    }

    const resolved = resolveChatModel({
      modelId: parsed.data.model,
      effort: parsed.data.effort,
      credentials: options.credentials,
      fetch: options.fetch,
    });
    const messages: ModelMessage[] = parsed.data.messages.map(message => ({
      role: message.role,
      content: message.parts.map(part => ({type: 'text' as const, text: part.text})),
    }));

    const result = streamText({
      ...resolved,
      messages,
      abortSignal: signal,
      maxRetries: 0,
      // Errors are surfaced by fullStream below rather than logged by the SDK.
      onError: () => {},
    });

    for await (const part of result.fullStream) {
      if (signal.aborted || part.type === 'abort') return;
      if (part.type === 'text-delta') {
        yield {type: 'text-delta', text: part.text};
      } else if (part.type === 'error') {
        yield toChatErrorEvent(part.error, 'provider_error');
        return;
      } else if (part.type === 'finish') {
        if (part.finishReason === 'error' || part.finishReason === 'other') {
          throw new ChatError('provider_error', 'The provider response ended without completing.');
        }
        const usage = toTokenUsage(part.totalUsage);
        yield {
          type: 'done',
          durationMs: performance.now() - startedAt,
          ...(usage === undefined ? {} : {usage}),
        };
        return;
      }
    }

    if (!signal.aborted) {
      throw new ChatError('provider_error', 'The provider response ended without completing.');
    }
  } catch (error) {
    if (!signal.aborted) yield toChatErrorEvent(error);
  } finally {
    // Also stop the provider if a caller stops consuming the generator.
    controller.abort();
  }
}
