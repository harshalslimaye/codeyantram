import type {Response} from 'express';
import type {ChatStreamOptions, ProviderCredentials} from '@codeyantram/core';
import type {ChatStreamEvent, CompactStreamEvent} from '@codeyantram/shared';
import {openEventStream, startHeartbeat, writeStreamEvent} from './sse.js';

interface EventStreamOptions<TRequest extends {model: string}> {
  request: TRequest;
  readCredentials: (modelId: string) => Promise<ProviderCredentials>;
  generate: (request: TRequest, options: ChatStreamOptions) => AsyncIterable<ChatStreamEvent | CompactStreamEvent>;
  errorMessage: string;
}

/** Shared SSE lifecycle for chat and compaction after request validation. */
export async function serveEventStream<TRequest extends {model: string}>(
  response: Response,
  options: EventStreamOptions<TRequest>,
): Promise<void> {
  const controller = new AbortController();
  let heartbeat: NodeJS.Timeout | undefined;
  const abort = () => {
    controller.abort();
    clearInterval(heartbeat);
  };
  // IncomingMessage closes after reading a complete POST; response close tracks
  // the client leaving the stream, including server shutdown closing its socket.
  response.once('close', abort);
  response.once('error', abort);

  try {
    const credentials = await options.readCredentials(options.request.model);
    if (controller.signal.aborted || response.destroyed) return;

    openEventStream(response);
    heartbeat = startHeartbeat(response);
    for await (const event of options.generate(options.request, {
      credentials, abortSignal: controller.signal,
    })) {
      if (controller.signal.aborted || response.destroyed) break;
      await writeStreamEvent(response, event, controller.signal);
      if (event.type === 'done' || event.type === 'error') break;
    }
  } catch {
    if (!controller.signal.aborted && !response.destroyed) {
      const event = {
        type: 'error', code: 'internal_error', message: options.errorMessage,
      } satisfies ChatStreamEvent;
      if (response.headersSent) {
        await writeStreamEvent(response, event, controller.signal).catch(() => {});
      } else {
        response.status(500).json(event);
      }
    }
  } finally {
    controller.abort();
    clearInterval(heartbeat);
    response.off('close', abort);
    response.off('error', abort);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}
