import {createReadService, createGrepService, createGlobService, createGitService,
  createApplyPatchService, createBashService, createWebFetchService, TOOL_CATALOG,
  type AgentRegistry, type ChatStreamOptions} from '@codeyantram/core';
import {readConfig, readProviderCredentials, type AgentMetadata, type ChatRequest, type ResolvedAgent} from '@codeyantram/shared';
import {resolveJevCapability} from '../integrations/jev.js';
import type {ServerAppOptions} from '../app.js';

export function agentMetadata(agents: AgentRegistry, options: ServerAppOptions): AgentMetadata[] {
  return agents.list().map(agent => ({id: agent.id, name: agent.name, description: agent.description,
    source: agent.source, approval: agent.approval,
    available: options.agentStatus?.(agent.id).available ?? agent.approval !== 'automatic',
    tools: agent.tools.filter(name => {
      const entry = TOOL_CATALOG.find(tool => tool.name === name);
      if (entry === undefined) return false;
      if (entry.capability === 'workspace_write') return options.agentStatus?.(agent.id).patch === true;
      if (entry.capability === 'command') return options.agentStatus?.(agent.id).command === true;
      return entry.service === 'webFetch' || (options.workspaceRoot !== undefined && options.workspaceRoot !== '');
    })}));
}

function resolvePolicy(agent: ResolvedAgent, request: ChatRequest, options: ServerAppOptions) {
  const authorization = options.authorizeAgent?.(request) ?? {};
  const approvePatch = options.approvePatchForTurn?.(request) ?? options.approvePatch;
  const approveCommand = options.approveCommandForTurn?.(request) ?? options.approveCommand;
  const automatic = agent.approval !== 'automatic' || authorization.automatic === true;
  const patch = mutationAllowed(agent, automatic, authorization.patch, approvePatch);
  const command = mutationAllowed(agent, automatic, authorization.command, approveCommand);
  const tools = agent.tools.filter(name => (name !== 'apply_patch' || patch) && (name !== 'bash' || command));
  return {agent: Object.freeze({...agent, tools: Object.freeze(tools)}) as ResolvedAgent, patch, command, approvePatch, approveCommand};
}

function mutationAllowed(agent: ResolvedAgent, automatic: boolean, requested: boolean | undefined,
  approver: unknown): boolean {
  return automatic && agent.approval !== 'none' && requested === true && approver !== undefined;
}

export async function readChatOptions(request: ChatRequest, signal: AbortSignal,
  agents: AgentRegistry, options: ServerAppOptions): Promise<ChatStreamOptions> {
  const selected = agents.get(request.agentId ?? 'ask');
  if (selected === undefined) throw new Error('Selected agent unavailable.');
  const policy = resolvePolicy(selected, request, options);
  const config = await (options.readConfig ?? readConfig)();
  const jev = resolveJevCapability(config, signal, options.createJevEvaluator);
  const workspaceRoot = options.workspaceRoot;
  return {
    credentials: await readProviderCredentials(request.model, async () => config),
    agent: policy.agent,
    jev,
    ...(workspaceRoot !== undefined && workspaceRoot !== '' ? {
      read: createReadService({workspaceRoot, jev}),
      grep: createGrepService({workspaceRoot, jev}),
      glob: createGlobService({workspaceRoot, jev}),
      git: createGitService({workspaceRoot, jev}),
      ...(policy.patch && policy.approvePatch !== undefined ?
        {applyPatch: createApplyPatchService({workspaceRoot, approve: policy.approvePatch})} : {}),
      ...(policy.command && policy.approveCommand !== undefined ?
        {bash: createBashService({workspaceRoot, approve: policy.approveCommand, environment: options.commandEnvironment})} : {}),
    } : {}),
    webFetch: createWebFetchService({transport: options.webTransport, jev}),
  };
}
