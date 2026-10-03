import {Router} from 'express';
import type {streamChat, ProviderCredentials} from '@codeyantram/core';
import {chatRequestSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {serveEventStream} from '../http/stream.js';

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

    await serveEventStream(response, {
      request: parsed.data,
      readCredentials: dependencies.readCredentials,
      generate: dependencies.streamChat,
      errorMessage: 'The chat request could not be completed.',
    });
  });

  return router;
}
