import {toolResultSchema, type ToolResult} from '@codeyantram/shared';
import type {ToolExecutor} from './types.js';
import {mapGraphError} from './codegraph/graph-errors.js';
import {WebFetchError} from './web-fetch/errors.js';
import {ReadError} from './read/errors.js';
import {GrepError} from './grep/errors.js';
import {GlobError} from './glob/errors.js';
import {ApplyPatchError} from './apply-patch/errors.js';
import {BashError} from './bash/errors.js';

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
      if (signal?.aborted === true) return error('cancelled', 'Tool execution cancelled.');
      const mapped = mapToolFailure(name, failure);
      return error(mapped.code, mapped.message);
    }
  };
}

function mapToolFailure(name: string, failure: unknown): Extract<ToolResult, {status: 'error'}>['error'] {
  if (failure instanceof WebFetchError || failure instanceof ReadError || failure instanceof GrepError || failure instanceof GlobError || failure instanceof ApplyPatchError || failure instanceof BashError) return {code: failure.code, message: failure.message};
  const message = new Map([
    ['apply_patch', 'The patch could not complete safely. Re-read every target before retrying.'],
    ['bash', 'Command execution failed. Side effects may have occurred; inspect the workspace before retrying.'],
    ['glob', 'Workspace file discovery could not complete safely.'],
    ['grep', 'Workspace search could not complete safely.'],
    ['read', 'The file could not be read safely.'],
    ['web_fetch', 'Web fetch could not complete the request.'],
  ]).get(name);
  if (message !== undefined) return {code: 'execution_failed', message};
  return mapGraphError(failure);
}

export const createNavigationExecutor = createToolExecutor;
