import {once} from 'node:events';
import type {Response} from 'express';
import type {ChatStreamEvent, CompactStreamEvent} from '@codeyantram/shared';

const HTTP_OK = 200;
const HEARTBEAT_INTERVAL_MS = 15_000;

export function openEventStream(response: Response): void {
  response.status(HTTP_OK).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
}

export async function writeStreamEvent(
  response: Response,
  event: ChatStreamEvent | CompactStreamEvent,
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
  }, HEARTBEAT_INTERVAL_MS).unref();
}
