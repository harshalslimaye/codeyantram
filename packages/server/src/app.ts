import express from 'express';
import {compactChat, streamChat} from '@codeyantram/core';
import {readConfig, readProviderCredentials} from '@codeyantram/shared';
import {handleError} from './middlewares/index.js';
import {createChatRouter} from './routers/chat.js';
import {createCompactRouter} from './routers/compact.js';
import {WorkspaceGraphService} from './graph/workspace.js';
import type {acquireGraphCoordinator} from '@codeyantram/graph';

export interface ServerAppOptions {
  /** Project root selected by the host; graph storage canonicalizes it on first use. */
  workspaceRoot?: string;
  acquireGraphCoordinator?: typeof acquireGraphCoordinator;
  readConfig?: typeof readConfig;
  streamChat?: typeof streamChat;
  compactChat?: typeof compactChat;
}

export function createApp(options: ServerAppOptions = {}) {
  const app = express();
  const workspaceGraph = new WorkspaceGraphService(options.workspaceRoot, options.acquireGraphCoordinator);
  app.locals.workspaceRoot = options.workspaceRoot;
  app.locals.workspaceGraph = workspaceGraph;
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
  return Object.assign(app, {workspaceGraph, close: () => workspaceGraph.close()});
}
