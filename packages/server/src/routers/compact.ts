import {Router} from 'express';
import type {compactChat, ProviderCredentials} from '@codeyantram/core';
import {compactRequestSchema, type CompactStreamEvent} from '@codeyantram/shared';
import {serveEventStream} from '../http/stream.js';

const HTTP_BAD_REQUEST = 400;

export interface CompactDependencies {
  readCredentials: (modelId: string) => Promise<ProviderCredentials>;
  compactChat: typeof compactChat;
}

export function createCompactRouter(dependencies: CompactDependencies): Router {
  const router = Router();
  router.post('/compact', async (request, response) => {
    const parsed = compactRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(HTTP_BAD_REQUEST).json({
        type: 'error', code: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid compaction request.',
      } satisfies CompactStreamEvent);
      return;
    }
    await serveEventStream(response, {
      request: parsed.data,
      readCredentials: dependencies.readCredentials,
      generate: dependencies.compactChat,
      errorMessage: 'The compaction request could not be completed.',
    });
  });
  return router;
}
