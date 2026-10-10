import {toolResultSchema, type ToolResult} from '@codeyantram/shared';
import type {ToolExecutor} from './types.js';
import {mapGraphError} from './graph-errors.js';
import {WebFetchError} from './web-fetch/errors.js';

const MAX_TOOL_EXECUTIONS = 12;
const MAX_TOOL_OUTPUT_BYTES = 80_000;

/** Create once per turn so navigation and web tools share the same call budget. */
export function createToolExecutor(): ToolExecutor {
  let executions = 0;
  return async (name, id, signal, run) => {
    const error = (code: Extract<ToolResult, {status: 'error'}>['error']['code'], message: string): ToolResult =>
      ({toolCallId: id, toolName: name, status: 'error', error: {code, message}});
    if (++executions > MAX_TOOL_EXECUTIONS) return error('tool_limit', 'The tool call limit was reached. Narrow the task or continue in another turn.');
    try {
      signal?.throwIfAborted();
      const output = await run();
      signal?.throwIfAborted();
      const result = toolResultSchema.parse({toolCallId: id, toolName: name, status: 'success', output});
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_TOOL_OUTPUT_BYTES) return error('execution_failed', 'Tool output exceeded the host limit. Request less context.');
      return result;
    } catch (failure) {
      if (signal?.aborted) return error('cancelled', 'Tool execution cancelled.');
      if (failure instanceof WebFetchError) return error(failure.code, failure.message);
      if (name === 'web_fetch') return error('execution_failed', 'Web fetch could not complete the request.');
      const mapped = mapGraphError(failure);
      return error(mapped.code, mapped.message);
    }
  };
}

export const createNavigationExecutor = createToolExecutor;
