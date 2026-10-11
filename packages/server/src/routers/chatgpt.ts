import {Router} from 'express';
import {z} from 'zod';
import type {ChatGPTSessionService} from '@codeyantram/core';
import {saveProviderApiKey} from '@codeyantram/shared';

const optionalProfile = z.object({profileId: z.string().min(1).optional()});
const selectProfile = z.object({profileId: z.string().min(1)});
const apiKeyInput = z.object({apiKey: z.string().trim().min(1)});
const HTTP_BAD_REQUEST = 400;
const HTTP_INTERNAL_ERROR = 500;

/** Mounted only by a CLI-owned app with its private session-token middleware. */
export function createChatGPTRouter(session: ChatGPTSessionService): Router {
  const router = Router();
  router.get('/chatgpt/status', async (_request, response) => {
    try {response.json(await session.status());} catch {response.status(HTTP_INTERNAL_ERROR).json({message: 'Could not read ChatGPT status.'});}
  });
  router.get('/chatgpt/models', async (_request, response) => {
    try {response.json({models: await session.models()});} catch {response.status(HTTP_BAD_REQUEST).json({message: 'ChatGPT models are unavailable. Sign in and check plan usage.'});}
  });
  router.post('/chatgpt/login', async (request, response) => {
    const input = optionalProfile.safeParse(request.body ?? {});
    if (!input.success) {response.status(HTTP_BAD_REQUEST).json({message: 'Invalid ChatGPT profile.'}); return;}
    const controller = new AbortController();
    const onClose = () => controller.abort();
    response.once('close', onClose);
    try {if (!controller.signal.aborted) response.json(await session.login(input.data.profileId, controller.signal));}
    catch (error) {if (!response.destroyed) response.status(HTTP_BAD_REQUEST).json({message: error instanceof Error ? error.message : 'ChatGPT sign-in failed.'});}
    finally {response.off('close', onClose);}
  });
  router.post('/chatgpt/select', async (request, response) => {
    const input = selectProfile.safeParse(request.body);
    if (!input.success) {response.status(HTTP_BAD_REQUEST).json({message: 'Invalid ChatGPT profile.'}); return;}
    try {response.json(await session.select(input.data.profileId));}
    catch {response.status(HTTP_BAD_REQUEST).json({message: 'ChatGPT profile is unavailable.'});}
  });
  router.post('/chatgpt/logout', async (request, response) => {
    const input = optionalProfile.safeParse(request.body ?? {});
    if (!input.success) {response.status(HTTP_BAD_REQUEST).json({message: 'Invalid ChatGPT profile.'}); return;}
    try {response.json(await session.logout(input.data.profileId));}
    catch {response.status(HTTP_INTERNAL_ERROR).json({message: 'Could not sign out of ChatGPT.'});}
  });
  router.post('/openai/api-key', async (request, response) => {
    const input = apiKeyInput.safeParse(request.body);
    if (!input.success) {response.status(HTTP_BAD_REQUEST).json({message: 'An OpenAI API key is required.'}); return;}
    try {
      const result = await session.logoutAll();
      await saveProviderApiKey('openai', input.data.apiKey);
      response.json(result);
    } catch {response.status(HTTP_INTERNAL_ERROR).json({message: 'Could not save the OpenAI API key. The ChatGPT login may have been removed; retry the connection.'});}
  });
  return router;
}
