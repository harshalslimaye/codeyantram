import {streamText, isStepCount, type ModelMessage, type PrepareStepFunction, type ToolSet} from 'ai';
import {chatRequestSchema, olderToolResultIds, type ChatRequest, type ResolvedAgent} from '@codeyantram/shared';
import {ChatError} from './errors.js';
import {resolveChatModel} from './models.js';
import {toModelMessages} from './messages.js';
import {createToolExecutor, MAX_TOOL_EXECUTIONS} from '../tools/index.js';
import type {ChatStreamOptions} from './stream.js';
import {BUILTIN_AGENTS} from '../agents/builtins.js';
import {createAgentTools} from './agent-tools.js';
import {ToolResultArchive} from './tool-result-archive.js';
import {olderStepToolResultIds, projectModelToolResults} from './tool-result-context.js';
import type {ToolExecutor} from '../tools/types.js';

const MAX_TOOL_OBJECTIVE_CHARACTERS = 2048;
const MAX_TOOL_STEPS = 10;
const DEFAULT_TRIM_BATCH_BYTES = 32_768;
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
  const context = prepareToolResultContext({request: parsed.data, options, agent, tools, instructions, execute, executions: () => toolExecutions});
  const hasTools = Object.keys(tools).length > 0;
  return streamText({
    ...resolved,
    messages: context.initialMessages,
    abortSignal: signal,
    maxRetries: 0,
    instructions: context.baseInstructions,
    ...(hasTools ? {
      tools, stopWhen: isStepCount(MAX_TOOL_STEPS),
      prepareStep: context.prepareStep,
    } : {}),
    // Errors are surfaced by the event stream rather than logged by the SDK.
    onError: () => {},
  });
}

interface ToolResultContextOptions {
  request: ChatRequest; options: ChatStreamOptions; agent: ResolvedAgent; tools: ToolSet;
  instructions: string; execute: ToolExecutor; executions: () => number;
}

function prepareToolResultContext(input: ToolResultContextOptions) {
  const {request, options, agent, tools, instructions, execute, executions} = input;
  const initialMessages = toModelMessages(request);
  const archive = new ToolResultArchive();
  // Context recovery grants no workspace/network access. Explicit tools:[] stays tool-free.
  const recoveryAvailable = Object.keys(tools).length > 0 || initialMessages.some(message => message.role === 'tool');
  const trimming = options.toolResultTrimming !== false && request.toolResultTrimming !== false && agent.tools.length > 0 && recoveryAvailable;
  if (trimming) {
    archive.record(initialMessages);
    tools.tool_result_read = archive.createTool(execute);
  }
  const older = trimming ? olderToolResultIds(request.messages) : new Set<string>();
  const baseInstructions = `${instructions}\n\nTurn budget: up to ${MAX_TOOL_STEPS} provider steps and ${MAX_TOOL_EXECUTIONS} tool executions. Use the budget deliberately, avoid unnecessary tool calls, and finish the task with the evidence available.`
    + (trimming ? '\nOlder tool outputs may be concise historical records. Use tool_result_read with their original toolCallId to recover omitted details before relying on them. Recovery uses the same turn budget. Historical hashes do not establish current source state.' : '');
  const batcher = createTrimBatcher(options.toolResultTrimBatchBytes ?? DEFAULT_TRIM_BATCH_BYTES, id => archive.isAmbiguous(id));
  const prepareStep: PrepareStepFunction<ToolSet> = ({stepNumber, initialMessages: original, responseMessages, steps}) => {
    if (trimming) archive.record(responseMessages);
    const full = [...original, ...responseMessages];
    const candidates = [...older, ...(trimming ? olderStepToolResultIds(steps) : [])];
    const projection = projectModelToolResults(full, batcher.select(full, candidates, stepNumber), stepNumber);
    options.onToolResultContext?.({...projection.diagnostic, ...archive.diagnostics()});
    const reminders = budgetReminders(stepNumber, executions());
    const messages: ModelMessage[] = reminders.length === 0 ? projection.messages
      : [...projection.messages, {role: 'user', content: `Turn budget update: ${reminders.join(' ')}`}];
    return {messages, instructions: baseInstructions,
      ...(executions() >= MAX_TOOL_EXECUTIONS || stepNumber === MAX_TOOL_STEPS - 1 ? {toolChoice: 'none' as const} : {})};
  };
  return {initialMessages, baseInstructions, prepareStep};
}

function createTrimBatcher(batchBytes: number, isAmbiguous: (id: string) => boolean) {
  const applied = new Set<string>();
  return {select(messages: readonly ModelMessage[], candidates: readonly string[], stepNumber: number): Set<string> {
    const pending = candidates.filter(id => !applied.has(id) && !isAmbiguous(id));
    if (pending.length > 0 && (stepNumber === 0 || trimSavings(messages, pending, stepNumber) >= batchBytes)) {
      for (const id of pending) applied.add(id);
    }
    return new Set([...applied].filter(id => !isAmbiguous(id)));
  }};
}

function trimSavings(messages: readonly ModelMessage[], ids: readonly string[], stepNumber: number): number {
  const {diagnostic} = projectModelToolResults(messages, new Set(ids), stepNumber);
  return diagnostic.originalResultBytes - diagnostic.projectedResultBytes;
}

function budgetReminders(stepNumber: number, executions: number): string[] {
  const reminders: string[] = [];
  if (stepNumber === FIVE_STEPS_COMPLETED) reminders.push('Five provider steps have been completed; five steps remain.');
  if (stepNumber === TWO_STEPS_REMAINING) reminders.push('Eight provider steps have been completed; only two steps remain. Prioritize completing the task.');
  if (executions === HALF_TOOL_EXECUTIONS) reminders.push('Ten tool executions have been used; ten remain.');
  if (executions === FIVE_TOOL_EXECUTIONS_REMAINING) reminders.push('Fifteen tool executions have been used; only five remain.');
  if (executions >= MAX_TOOL_EXECUTIONS) reminders.push('The tool execution budget is exhausted. Tool and recovery calls are unavailable; finish with available evidence.');
  if (stepNumber === MAX_TOOL_STEPS - 1) reminders.push(`This is the final provider step. Tool and recovery calls are unavailable; finish with available evidence. ${Math.max(0, MAX_TOOL_EXECUTIONS - executions)} tool executions were unused.`);
  return reminders;
}
