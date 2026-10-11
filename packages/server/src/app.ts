import express from 'express';
import {compactChat, streamChat, createAgentRegistry, type AgentRegistry, type AgentDiagnostic, type BashApprover, type PatchApprover,
  type createJevEvaluator, type WebTransport} from '@codeyantram/core';
import {readProviderCredentials, type readConfig, type ChatRequest, type AgentApprovalPolicy} from '@codeyantram/shared';
import {handleError} from './middlewares/index.js';
import {createChatRouter} from './routers/chat.js';
import {createCompactRouter} from './routers/compact.js';
import {WorkspaceGraphService} from './graph/workspace.js';
import type {acquireGraphCoordinator} from '@codeyantram/graph';
import {agentMetadata, readChatOptions} from './agents/host.js';

const HTTP_FORBIDDEN = 403;

export interface ServerAppOptions {
  initialAgents?: {registry: AgentRegistry; diagnostics: readonly AgentDiagnostic[]};
  reloadAgents?: () => Promise<{registry: AgentRegistry; diagnostics: readonly AgentDiagnostic[]}>;
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
  /** Host-owned authorization, evaluated for each turn. Missing means read-only. */
  authorizeAgent?: (request: ChatRequest) => {patch?: boolean; command?: boolean; automatic?: boolean};
  /** Reject a selected agent before opening SSE when host session state disagrees. */
  validateAgent?: (request: ChatRequest) => boolean;
  /** Optional per-turn approvers keep automatic decisions bound to the turn snapshot. */
  approvePatchForTurn?: (request: ChatRequest) => PatchApprover | undefined;
  approveCommandForTurn?: (request: ChatRequest) => BashApprover | undefined;
  agentStatus?: (id: string, approval: AgentApprovalPolicy) => {available: boolean; patch: boolean; command: boolean};
  /** Required on every CLI-owned HTTP route when set. */
  privateSessionToken?: string;
}

export function createApp(options: ServerAppOptions = {}) {
  const app = express();
  const workspaceGraph = new WorkspaceGraphService(options.workspaceRoot, options.acquireGraphCoordinator);
  let agentState = options.initialAgents ?? {registry: createAgentRegistry(), diagnostics: []};
  const turnRegistries = new WeakMap<ChatRequest, AgentRegistry>();
  app.locals.workspaceRoot = options.workspaceRoot;
  app.locals.workspaceGraph = workspaceGraph;
  const chatRouter = createChatRouter({
    agents: () => agentMetadata(agentState.registry, options),
    diagnostics: () => agentState.diagnostics,
    reloadAgents: options.reloadAgents === undefined ? undefined : async () => {
      const next = await options.reloadAgents?.();
      if (next === undefined) throw new Error('Reload is unavailable.');
      agentState = next;
      return next.diagnostics;
    },
    hasAgent: id => agentState.registry.get(id) !== undefined,
    validateAgent: request => {
      if (options.validateAgent?.(request) === false) return false;
      turnRegistries.set(request, agentState.registry);
      return true;
    },
    readCredentials: modelId => readProviderCredentials(modelId, options.readConfig),
    readOptions: (request, signal) => readChatOptions(request, signal, turnRegistries.get(request) ?? agentState.registry, options),
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
  if (options.privateSessionToken !== undefined) app.use((request, response, next) => {
    if (request.header('x-codeyantram-session') !== options.privateSessionToken) {
      response.status(HTTP_FORBIDDEN).json({type: 'error', code: 'invalid_request', message: 'Private session token required.'});
      return;
    }
    next();
  });
  app.use(express.json({limit: '4mb'}));
  app.use(chatRouter);
  app.use(compactRouter);

  app.use(handleError);
  return Object.assign(app, {workspaceGraph, close: () => workspaceGraph.close()});
}
