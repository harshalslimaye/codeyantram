import {performance} from 'node:perf_hooks';
import type {ModelMessage, StepResult, ToolSet} from 'ai';
import {emptyToolResultProjectionStats, projectToolResult, KEEP_TOOL_RESULT_STEPS,
  type ToolResultProjectionStats} from '@codeyantram/shared';
import {resultFromModelPart} from './tool-result-archive.js';

export interface ToolResultContextDiagnostic extends ToolResultProjectionStats {
  stepNumber: number;
  durationMs: number;
  recoveryCalls: number;
  recoveryBytes: number;
}

/** Project complete SDK history; never feed a prior projection into this function. */
export function projectModelToolResults(messages: readonly ModelMessage[], eligible: ReadonlySet<string>, stepNumber: number) {
  const started = performance.now();
  const stats = emptyToolResultProjectionStats();
  const projected = messages.map(message => {
    if (message.role !== 'tool') return message;
    return {...message, content: message.content.map(part => {
      if (part.type !== 'tool-result') return part;
      const result = resultFromModelPart(part);
      if (result === undefined) return part;
      const replacement = projectToolResult(result, eligible.has(result.toolCallId), stats);
      return replacement === result ? part : {...part, output: {...part.output, type: 'json' as const, value: replacement}};
    })};
  });
  return {messages: projected, diagnostic: {...stats, stepNumber, durationMs: performance.now() - started}};
}

export function olderStepToolResultIds(steps: readonly StepResult<ToolSet>[]): Set<string> {
  const batches = steps.map(step => step.response.messages.flatMap(message => message.role === 'tool'
    ? message.content.flatMap(part => part.type === 'tool-result' && part.toolName !== 'tool_result_read' ? [part.toolCallId] : []) : []))
    .filter(batch => batch.length > 0);
  return new Set(batches.slice(0, Math.max(0, batches.length - KEEP_TOOL_RESULT_STEPS)).flat());
}
