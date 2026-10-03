import {once} from 'node:events';
import type {Response} from 'express';
import type {ChatStreamEvent} from '@codeyantram/shared';

export function openEventStream(response: Response): void {
  response.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
}

export async function writeStreamEvent(
  response: Response,
  event: ChatStreamEvent,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (!response.write(`data: ${JSON.stringify(event)}\n\n`)) {
    await once(response, 'drain', {signal});
  }
}

export function startHeartbeat(response: Response): NodeJS.Timeout {
  return setInterval(() => {
    if (!response.destroyed && !response.writableEnded && !response.writableNeedDrain) {
      response.write(': keep-alive\n\n');
    }
  }, 15_000).unref();
}
