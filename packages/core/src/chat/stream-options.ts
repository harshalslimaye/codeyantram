import {streamText, isStepCount} from 'ai';
import {chatRequestSchema, type ChatRequest} from '@codeyantram/shared';
import {ChatError} from './errors.js';
import {resolveChatModel} from './models.js';
import {toModelMessages} from './messages.js';
import {createToolExecutor} from '../tools/index.js';
import type {ChatStreamOptions} from './stream.js';
import {BUILTIN_AGENTS} from '../agents/builtins.js';
import {createAgentTools} from './agent-tools.js';

const MAX_TOOL_OBJECTIVE_CHARACTERS = 2048;
const MAX_TOOL_STEPS = 6;

export function createChatStream(request: ChatRequest, options: ChatStreamOptions, signal: AbortSignal) {
  const parsed = chatRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new ChatError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid chat request.');
  }
  const agent = options.agent ?? BUILTIN_AGENTS[0];
  if (agent === undefined || (parsed.data.agentId ?? 'ask') !== agent.id) {
    throw new ChatError('invalid_request', 'The selected agent is unavailable or does not match the request.');
  }

  const resolved = resolveChatModel({
    modelId: parsed.data.model,
    effort: parsed.data.effort,
    credentials: options.credentials,
    fetch: options.fetch,
    chatgpt: options.chatgpt,
  });
  const execute = createToolExecutor();
  const latestUser = [...parsed.data.messages].reverse().find(message => message.role === 'user');
  const objective = latestUser?.parts.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, MAX_TOOL_OBJECTIVE_CHARACTERS);
  const {tools, instructions} = createAgentTools(agent, options, execute, objective);
  const hasTools = Object.keys(tools).length > 0;
  return streamText({
    ...resolved,
    messages: toModelMessages(parsed.data),
    abortSignal: signal,
    maxRetries: 0,
    instructions,
    ...(hasTools ? {
      tools, stopWhen: isStepCount(MAX_TOOL_STEPS),
    } : {}),
    // Errors are surfaced by the event stream rather than logged by the SDK.
    onError: () => {},
  });
}
