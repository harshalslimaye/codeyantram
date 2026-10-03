import express from 'express';
import {streamChat} from '@codeyantram/core';
import {readConfig} from '@codeyantram/shared';
import {handleError} from './middlewares/index.js';
import {readProviderCredentials} from './providers/config.js';
import {createChatRouter} from './routers/chat.js';

export interface ServerAppOptions {
  readConfig?: typeof readConfig;
  streamChat?: typeof streamChat;
}

export function createApp(options: ServerAppOptions = {}) {
  const app = express();
  const chatRouter = createChatRouter({
    readCredentials: modelId => readProviderCredentials(modelId, options.readConfig),
    // Tests can supply a fake stream to avoid calling AI providers.
    streamChat: options.streamChat ?? streamChat,
  });

  app.disable('x-powered-by');
  app.use(express.json({limit: '4mb'}));
  app.use(chatRouter);

  app.use(handleError);
  return app;
}
