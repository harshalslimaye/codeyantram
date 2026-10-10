import {createReadService, createGrepService, createGlobService, createGitService,
  createApplyPatchService, createBashService, createWebFetchService, TOOL_CATALOG,
  type AgentRegistry, type ChatStreamOptions} from '@codeyantram/core';
import {readConfig, readProviderCredentials, type AgentMetadata, type ChatRequest, type ResolvedAgent} from '@codeyantram/shared';
import {resolveJevCapability} from '../integrations/jev.js';
import type {ServerAppOptions} from '../app.js';

export function agentMetadata(agents: AgentRegistry, options: ServerAppOptions): AgentMetadata[] {
  return agents.list().map(agent => ({id: agent.id, name: agent.name, description: agent.description,
    source: agent.source, approval: agent.approval, available: agent.approval !== 'automatic',
    tools: agent.tools.filter(name => {
      const entry = TOOL_CATALOG.find(tool => tool.name === name);
      if (entry === undefined) return false;
      if (entry.capability === 'workspace_write' || entry.capability === 'command') return false;
      return entry.service === 'webFetch' || (options.workspaceRoot !== undefined && options.workspaceRoot !== '');
    })}));
}

function resolvePolicy(agent: ResolvedAgent, request: ChatRequest, options: ServerAppOptions) {
  const authorization = options.authorizeAgent?.(request) ?? {};
  const automatic = agent.approval !== 'automatic' || authorization.automatic === true;
  const patch = automatic && agent.approval !== 'none' && authorization.patch === true && options.approvePatch !== undefined;
  const command = automatic && agent.approval !== 'none' && authorization.command === true && options.approveCommand !== undefined;
  const tools = agent.tools.filter(name => (name !== 'apply_patch' || patch) && (name !== 'bash' || command));
  return {agent: Object.freeze({...agent, tools: Object.freeze(tools)}) as ResolvedAgent, patch, command};
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
      ...(policy.patch && options.approvePatch !== undefined ?
        {applyPatch: createApplyPatchService({workspaceRoot, approve: options.approvePatch})} : {}),
      ...(policy.command && options.approveCommand !== undefined ?
        {bash: createBashService({workspaceRoot, approve: options.approveCommand, environment: options.commandEnvironment})} : {}),
    } : {}),
    webFetch: createWebFetchService({transport: options.webTransport, jev}),
  };
}
