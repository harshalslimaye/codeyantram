import type {RequestMessage} from './types.js';
import type {ToolResult} from '../tools/types.js';
import {trimToolResult, serializedToolResultBytes, MIN_TRIM_RESULT_BYTES} from './tool-result-record.js';

export const KEEP_TOOL_RESULT_TURNS = 2;
export const KEEP_TOOL_RESULT_STEPS = 2;

export interface ToolResultProjectionStats {
  eligibleResults: number;
  trimmedResults: number;
  originalResultBytes: number;
  projectedResultBytes: number;
  skippedReasons: {protectedOrDisabled: number; error: number; small: number; unsupportedOrMetadataLimit: number};
}

export function emptyToolResultProjectionStats(): ToolResultProjectionStats {
  return {eligibleResults: 0, trimmedResults: 0, originalResultBytes: 0, projectedResultBytes: 0,
    skippedReasons: {protectedOrDisabled: 0, error: 0, small: 0, unsupportedOrMetadataLimit: 0}};
}

export function projectToolResult(result: ToolResult, eligible: boolean, stats: ToolResultProjectionStats): ToolResult {
  const originalBytes = serializedToolResultBytes(result);
  const replacement = eligible ? trimToolResult(result) : result;
  stats.originalResultBytes += originalBytes;
  stats.projectedResultBytes += serializedToolResultBytes(replacement);
  if (eligible) stats.eligibleResults++;
  if (replacement !== result) stats.trimmedResults++;
  else if (!eligible) stats.skippedReasons.protectedOrDisabled++;
  else if (result.status === 'error') stats.skippedReasons.error++;
  else if (originalBytes < MIN_TRIM_RESULT_BYTES) stats.skippedReasons.small++;
  else stats.skippedReasons.unsupportedOrMetadataLimit++;
  return replacement;
}

/** IDs only; the transcript and its call/result sequence are never modified. */
export function olderToolResultIds(messages: readonly RequestMessage[]): Set<string> {
  const stepIds = messages.flatMap(message => message.role === 'assistant' ? olderStepResultIds(message) : []);
  return new Set([...stepIds, ...olderTurnResultIds(messages)]);
}

function olderTurnResultIds(messages: readonly RequestMessage[]): string[] {
  const turns = messages.flatMap((message, index) => message.role === 'user' ? [index] : []);
  if (turns.length <= KEEP_TOOL_RESULT_TURNS) return [];
  const boundary = turns.at(-KEEP_TOOL_RESULT_TURNS) ?? 0;
  return messages.slice(0, boundary).flatMap(message => message.parts.flatMap(part =>
    part.type === 'tool-result' ? [part.result.toolCallId] : []));
}

function olderStepResultIds(message: RequestMessage): string[] {
  const steps = recordedSteps(message) ?? inferredSteps(message);
  const populated = steps.filter(step => step.length > 0);
  return populated.slice(0, Math.max(0, populated.length - KEEP_TOOL_RESULT_STEPS)).flat();
}

function countsAsStepResult(part: RequestMessage['parts'][number]): part is Extract<RequestMessage['parts'][number], {type: 'tool-result'}> {
  return part.type === 'tool-result' && part.result.toolName !== 'tool_result_read';
}

function recordedSteps(message: RequestMessage): string[][] | undefined {
  const callSteps = new Map<string, number>();
  for (const part of message.parts) {
    if (part.type !== 'tool-call') continue;
    if (part.step === undefined) return undefined;
    callSteps.set(part.call.toolCallId, part.step);
  }
  const steps = new Map<number, string[]>();
  for (const part of message.parts) {
    const step = countsAsStepResult(part) ? callSteps.get(part.result.toolCallId) : undefined;
    if (step !== undefined && countsAsStepResult(part)) steps.set(step, [...(steps.get(step) ?? []), part.result.toolCallId]);
  }
  return [...steps].sort(([a], [b]) => a - b).map(([, ids]) => ids);
}

function inferredSteps(message: RequestMessage): string[][] {
  const steps: string[][] = [];
  let previous: string | undefined;
  for (const part of message.parts) {
    if (part.type === 'tool-call' && previous !== 'tool-call') steps.push([]);
    else if (countsAsStepResult(part)) {
      if (steps.length === 0) steps.push([]);
      steps.at(-1)?.push(part.result.toolCallId);
    }
    previous = part.type;
  }
  return steps;
}

/** Shared cross-turn projection for estimates. Wire requests still carry full originals. */
export function projectRequestToolResults(messages: readonly RequestMessage[], enabled = true) {
  const eligible = enabled ? olderToolResultIds(messages) : new Set<string>();
  const stats = emptyToolResultProjectionStats();
  const projected = messages.map(message => {
    if (message.role === 'user') return message;
    return {...message, parts: message.parts.map(part => {
      if (part.type !== 'tool-result') return part;
      const result = part.result;
      const replacement = projectToolResult(result, eligible.has(result.toolCallId), stats);
      return replacement === result ? part : {...part, result: replacement};
    })};
  });
  return {messages: projected, stats};
}
