import {tool} from 'ai';
import {z} from 'zod';
import {symbolReferenceSchema} from '@codeyantram/shared';
import type {NavigationExecutor, NavigationGraphService} from './types.js';

const MAX_TRACE_DEPTH = 3;
const MAX_RESULTS = 50;
const MIN_CONTEXT_CHARACTERS = 2048;
const MAX_CONTEXT_CHARACTERS = 24_000;

export const traceInputSchema = z.strictObject({
  reference: symbolReferenceSchema,
  direction: z.enum(['callers', 'callees']),
  depth: z.number().int().min(1).max(MAX_TRACE_DEPTH).optional(),
  limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
  maxCharacters: z.number().int().min(MIN_CONTEXT_CHARACTERS).max(MAX_CONTEXT_CHARACTERS).optional(),
});

export function createTraceTool(service: NavigationGraphService, execute: NavigationExecutor) {
  return tool({
    description: 'Follow resolved callers or callees of a reference from find/explore/trace. Traversal follows calls and instantiations, with bounded depth and related symbols. Returns relationship locations and provenance, references, coverage, and truncation. Stale references require rediscovery.',
    inputSchema: traceInputSchema,
    execute: (input, options) => execute('trace', options.toolCallId, options.abortSignal, async () => {
      const result = await service.query(reader => reader.trace(input.reference, input), {signal: options.abortSignal});
      return {context: result.value, freshness: result.freshness};
    }),
  });
}
