import {Router} from 'express';
import type {streamChat, ProviderCredentials, ChatStreamOptions} from '@codeyantram/core';
import {chatRequestSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {serveEventStream} from '../http/stream.js';

const HTTP_BAD_REQUEST = 400;

export interface ChatDependencies {
  readCredentials: (modelId: string) => Promise<ProviderCredentials>;
  readOptions?: (modelId: string, signal: AbortSignal) => Promise<ChatStreamOptions>;
  streamChat: typeof streamChat;
}

export function createChatRouter(dependencies: ChatDependencies): Router {
  const router = Router();

  router.post('/chat', async (request, response) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(HTTP_BAD_REQUEST).json({
        type: 'error', code: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid chat request.',
      } satisfies ChatStreamEvent);
      return;
    }

    await serveEventStream(response, {
      request: parsed.data,
      readCredentials: dependencies.readCredentials,
      readOptions: dependencies.readOptions,
      generate: dependencies.streamChat,
      errorMessage: 'The chat request could not be completed.',
    });
  });

  return router;
}
