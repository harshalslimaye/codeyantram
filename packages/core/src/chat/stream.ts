import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {ChatRequest, ChatStreamEvent} from '@codeyantram/shared';
import {toChatErrorEvent} from './errors.js';
import type {ProviderCredentials} from './models.js';
import type {NavigationGraphService, WebFetchService, ReadService} from '../tools/index.js';
import {createChatStream} from './stream-options.js';
import type {JevCapability} from '../evaluation/index.js';
import {translateProviderEvents} from './provider-events.js';

export interface ChatStreamOptions {
  credentials: ProviderCredentials;
  abortSignal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  workspaceGraph?: NavigationGraphService;
  webFetch?: WebFetchService;
  read?: ReadService;
  jev?: JevCapability;
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

    const result = createChatStream(request, options, signal);
    yield* translateProviderEvents(result.stream, signal, startedAt);
  } catch (error) {
    if (!signal.aborted) yield toChatErrorEvent(error);
  } finally {
    // Also stop the provider if a caller stops consuming the generator.
    controller.abort();
  }
}
