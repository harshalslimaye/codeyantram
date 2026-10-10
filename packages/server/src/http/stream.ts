import type {Response} from 'express';
import type {ChatStreamOptions, ProviderCredentials} from '@codeyantram/core';
import type {ChatStreamEvent, CompactStreamEvent} from '@codeyantram/shared';
import {openEventStream, startHeartbeat, writeStreamEvent} from './sse.js';

const HTTP_INTERNAL_SERVER_ERROR = 500;

interface EventStreamOptions<TRequest extends {model: string}> {
  request: TRequest;
  readCredentials: (modelId: string) => Promise<ProviderCredentials>;
  readOptions?: (modelId: string, signal: AbortSignal) => Promise<ChatStreamOptions>;
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
    const streamOptions = options.readOptions ? await options.readOptions(options.request.model, controller.signal)
      : {credentials: await options.readCredentials(options.request.model)};
    if (streamClosed(response, controller.signal)) return;

    openEventStream(response);
    heartbeat = startHeartbeat(response);
    for await (const event of options.generate(options.request, {
      ...streamOptions, abortSignal: controller.signal,
    })) {
      if (streamClosed(response, controller.signal)) break;
      await writeStreamEvent(response, event, controller.signal);
      if (event.type === 'done' || event.type === 'error') break;
    }
  } catch {
    await reportStreamError(response, controller.signal, options.errorMessage);
  } finally {
    controller.abort();
    clearInterval(heartbeat);
    response.off('close', abort);
    response.off('error', abort);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

function streamClosed(response: Response, signal: AbortSignal): boolean {
  return signal.aborted || response.destroyed;
}

async function reportStreamError(response: Response, signal: AbortSignal, errorMessage: string) {
  if (!signal.aborted && !response.destroyed) {
    const event = {
      type: 'error', code: 'internal_error', message: errorMessage,
    } satisfies ChatStreamEvent;
    if (response.headersSent) {
      await writeStreamEvent(response, event, signal).catch(() => {});
    } else {
      response.status(HTTP_INTERNAL_SERVER_ERROR).json(event);
    }
  }
}
