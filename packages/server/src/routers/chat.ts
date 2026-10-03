import {Router} from 'express';
import type {streamChat, ProviderCredentials} from '@codeyantram/core';
import {chatRequestSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {openEventStream, startHeartbeat, writeStreamEvent} from '../http/sse.js';

export interface ChatDependencies {
  readCredentials: (modelId: string) => Promise<ProviderCredentials>;
  streamChat: typeof streamChat;
}

export function createChatRouter(dependencies: ChatDependencies): Router {
  const router = Router();

  router.post('/chat', async (request, response) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        type: 'error', code: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid chat request.',
      } satisfies ChatStreamEvent);
      return;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    // IncomingMessage's close event also fires after reading a complete POST.
    // The response's close event tracks the client leaving the response stream.
    response.once('close', abort);
    response.once('error', abort);
    let heartbeat: NodeJS.Timeout | undefined;

    try {
      const credentials = await dependencies.readCredentials(parsed.data.model);
      if (controller.signal.aborted || response.destroyed) return;

      openEventStream(response);
      heartbeat = startHeartbeat(response);
      for await (const event of dependencies.streamChat(parsed.data, {
        credentials, abortSignal: controller.signal,
      })) {
        if (controller.signal.aborted || response.destroyed) break;
        await writeStreamEvent(response, event, controller.signal);
        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch {
      if (!controller.signal.aborted && !response.destroyed) {
        const event: ChatStreamEvent = {
          type: 'error', code: 'internal_error', message: 'The chat request could not be completed.',
        };
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
  });

  return router;
}
