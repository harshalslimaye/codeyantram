import {createReadService, createGrepService, createGlobService, createGitService,
  createApplyPatchService, createBashService, createWebFetchService, TOOL_CATALOG,
  type AgentRegistry, type ChatStreamOptions} from '@codeyantram/core';
import {chatGPTSupportedEfforts, readConfig, readProviderCredentials, usesChatGPTConnection, type AgentMetadata, type ChatRequest, type ResolvedAgent} from '@codeyantram/shared';
import {resolveJevCapability} from '../integrations/jev.js';
import {readProjectJevThresholds} from '../integrations/project-jev.js';
import type {ServerAppOptions} from '../app.js';

export function agentMetadata(agents: AgentRegistry, options: ServerAppOptions): AgentMetadata[] {
  return agents.list().map(agent => ({id: agent.id, name: agent.name, description: agent.description,
    source: agent.source, approval: agent.approval,
    available: options.agentStatus?.(agent.id, agent.approval).available ?? agent.approval !== 'automatic',
    tools: agent.tools.filter(name => {
      const entry = TOOL_CATALOG.find(tool => tool.name === name);
      if (entry === undefined) return false;
      if (entry.capability === 'workspace_write') return options.agentStatus?.(agent.id, agent.approval).patch === true;
      if (entry.capability === 'command') return options.agentStatus?.(agent.id, agent.approval).command === true;
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

// oxlint-disable-next-line eslint/complexity -- ChatGPT account validation extends the existing agent and capability resolution.
export async function readChatOptions(request: ChatRequest, signal: AbortSignal,
  agents: AgentRegistry, options: ServerAppOptions): Promise<ChatStreamOptions> {
  const selected = agents.get(request.agentId ?? 'ask');
  if (selected === undefined) throw new Error('Selected agent unavailable.');
  const policy = resolvePolicy(selected, request, options);
  const config = await (options.readConfig ?? readConfig)();
  const workspaceRoot = options.workspaceRoot;
  const projectThresholds = await readProjectJevThresholds(workspaceRoot);
  const jev = resolveJevCapability(config, signal, options.createJevEvaluator, projectThresholds);
  let chatgpt: ChatStreamOptions['chatgpt'];
  if (usesChatGPTConnection(config, request.model)) {
    const session = options.chatgptSession;
    if (!session) throw new Error('ChatGPT login is unavailable in this server.');
    const selectedProfile = await session.selected();
    if (!selectedProfile) throw new Error('Sign in with ChatGPT first.');
    const model = await session.model(request.model, signal);
    const supportedEffortLevels = chatGPTSupportedEfforts(request.model, model.supportedEffortLevels);
    if (request.effort !== undefined && !supportedEffortLevels.includes(request.effort)) throw new Error('This ChatGPT model does not support the selected reasoning effort.');
    if ((await session.selected())?.clientId !== selectedProfile.clientId) throw new Error('ChatGPT account changed during model selection.');
    chatgpt = {profileId: selectedProfile.clientId, supportedEffortLevels: [...supportedEffortLevels],
      getAccessToken: (id, abortSignal) => session.accessToken(id, abortSignal)};
  }
  return {
    credentials: await readProviderCredentials(request.model, async () => config),
    ...(chatgpt ? {chatgpt} : {}),
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
