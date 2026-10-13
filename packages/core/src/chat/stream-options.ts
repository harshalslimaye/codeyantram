import {streamText, isStepCount} from 'ai';
import {chatRequestSchema, type ChatRequest} from '@codeyantram/shared';
import {ChatError} from './errors.js';
import {resolveChatModel} from './models.js';
import {toModelMessages} from './messages.js';
import {createToolExecutor, MAX_TOOL_EXECUTIONS} from '../tools/index.js';
import type {ChatStreamOptions} from './stream.js';
import {BUILTIN_AGENTS} from '../agents/builtins.js';
import {createAgentTools} from './agent-tools.js';

const MAX_TOOL_OBJECTIVE_CHARACTERS = 2048;
const MAX_TOOL_STEPS = 10;
const HALF_TOOL_EXECUTIONS = 10;
const FIVE_TOOL_EXECUTIONS_REMAINING = 15;
const FIVE_STEPS_COMPLETED = 5;
const TWO_STEPS_REMAINING = 8;

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
  let toolExecutions = 0;
  const execute = createToolExecutor(count => {toolExecutions = count;});
  const latestUser = [...parsed.data.messages].reverse().find(message => message.role === 'user');
  const objective = latestUser?.parts.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, MAX_TOOL_OBJECTIVE_CHARACTERS);
  const {tools, instructions} = createAgentTools(agent, options, execute, objective);
  const hasTools = Object.keys(tools).length > 0;
  return streamText({
    ...resolved,
    messages: toModelMessages(parsed.data),
    abortSignal: signal,
    maxRetries: 0,
    instructions: `${instructions}\n\nTurn budget: up to ${MAX_TOOL_STEPS} provider steps and ${MAX_TOOL_EXECUTIONS} tool executions. Use the budget deliberately, avoid unnecessary tool calls, and finish the task with the evidence available.`,
    ...(hasTools ? {
      tools, stopWhen: isStepCount(MAX_TOOL_STEPS),
      prepareStep: ({stepNumber}: {stepNumber: number}) => {
        const reminders: string[] = [];
        if (stepNumber === FIVE_STEPS_COMPLETED) reminders.push('Five provider steps have been completed; five steps remain.');
        if (stepNumber === TWO_STEPS_REMAINING) reminders.push('Eight provider steps have been completed; only two steps remain. Prioritize completing the task.');
        const callsRemaining = Math.max(0, MAX_TOOL_EXECUTIONS - toolExecutions);
        if (toolExecutions === HALF_TOOL_EXECUTIONS) reminders.push('Ten tool executions have been used; ten remain.');
        if (toolExecutions === FIVE_TOOL_EXECUTIONS_REMAINING) reminders.push('Fifteen tool executions have been used; only five remain.');
        if (toolExecutions >= MAX_TOOL_EXECUTIONS) reminders.push('The tool execution budget is exhausted. Do not call tools again; finish with available evidence.');
        if (stepNumber === MAX_TOOL_STEPS - 1) {
          reminders.push(`This is the final provider step. After this response, the step budget is exhausted. ${callsRemaining} tool executions remain.`);
        }
        return reminders.length === 0 ? undefined : {instructions: `${instructions}\n\nTurn budget update: ${reminders.join(' ')}`};
      },
    } : {}),
    // Errors are surfaced by the event stream rather than logged by the SDK.
    onError: () => {},
  });
}
