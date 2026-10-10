import express from 'express';
import {compactChat, streamChat, createWebFetchService, createReadService, createGrepService, createGlobService, createApplyPatchService, createBashService, type BashApprover, type PatchApprover, type createJevEvaluator, type WebTransport} from '@codeyantram/core';
import {readConfig, readProviderCredentials} from '@codeyantram/shared';
import {handleError} from './middlewares/index.js';
import {createChatRouter} from './routers/chat.js';
import {createCompactRouter} from './routers/compact.js';
import {WorkspaceGraphService} from './graph/workspace.js';
import type {acquireGraphCoordinator} from '@codeyantram/graph';
import {resolveJevCapability} from './integrations/jev.js';

export interface ServerAppOptions {
  /** Project root selected by the host; graph storage canonicalizes it on first use. */
  workspaceRoot?: string;
  acquireGraphCoordinator?: typeof acquireGraphCoordinator;
  readConfig?: typeof readConfig;
  streamChat?: typeof streamChat;
  compactChat?: typeof compactChat;
  createJevEvaluator?: typeof createJevEvaluator;
  webTransport?: WebTransport;
  approvePatch?: PatchApprover;
  approveCommand?: BashApprover;
  commandEnvironment?: Record<string, string>;
}

export function createApp(options: ServerAppOptions = {}) {
  const app = express();
  const workspaceGraph = new WorkspaceGraphService(options.workspaceRoot, options.acquireGraphCoordinator);
  app.locals.workspaceRoot = options.workspaceRoot;
  app.locals.workspaceGraph = workspaceGraph;
  const chatRouter = createChatRouter({
    readCredentials: modelId => readProviderCredentials(modelId, options.readConfig),
    readOptions: async (modelId, signal) => {
      const config = await (options.readConfig ?? readConfig)();
      const jev = resolveJevCapability(config, signal, options.createJevEvaluator);
      return {
        credentials: await readProviderCredentials(modelId, async () => config),
        jev,
        ...((options.workspaceRoot !== undefined && options.workspaceRoot !== '')
          ? {read: createReadService({workspaceRoot: options.workspaceRoot, jev}),
            grep: createGrepService({workspaceRoot: options.workspaceRoot, jev}),
            glob: createGlobService({workspaceRoot: options.workspaceRoot, jev}),
            ...(options.approvePatch ? {applyPatch: createApplyPatchService({workspaceRoot: options.workspaceRoot, approve: options.approvePatch})} : {}),
            ...(options.approveCommand ? {bash: createBashService({workspaceRoot: options.workspaceRoot, approve: options.approveCommand, environment: options.commandEnvironment})} : {})} : {}),
        webFetch: createWebFetchService({transport: options.webTransport,
          jev}),
      };
    },
    // Tests can supply a fake stream to avoid calling AI providers.
    streamChat: (request, streamOptions) => (options.streamChat ?? streamChat)(request, {
      ...streamOptions, ...((options.workspaceRoot !== undefined && options.workspaceRoot !== '') ? {workspaceGraph} : {}),
    }),
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
