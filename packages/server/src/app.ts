import express from 'express';
import {compactChat, streamChat} from '@codeyantram/core';
import {readConfig} from '@codeyantram/shared';
import {handleError} from './middlewares/index.js';
import {readProviderCredentials} from './providers/config.js';
import {createChatRouter} from './routers/chat.js';
import {createCompactRouter} from './routers/compact.js';

export interface ServerAppOptions {
  readConfig?: typeof readConfig;
  streamChat?: typeof streamChat;
  compactChat?: typeof compactChat;
}

export function createApp(options: ServerAppOptions = {}) {
  const app = express();
  const chatRouter = createChatRouter({
    readCredentials: modelId => readProviderCredentials(modelId, options.readConfig),
    // Tests can supply a fake stream to avoid calling AI providers.
    streamChat: options.streamChat ?? streamChat,
  });
  const compactRouter = createCompactRouter({
    readCredentials: modelId => readProviderCredentials(modelId, options.readConfig),
    compactChat: options.compactChat ?? compactChat,
  });

  app.disable('x-powered-by');
  app.use(express.json({limit: '4mb'}));
  app.use(chatRouter);
  app.use(compactRouter);

  app.use(handleError);
  return app;
}
