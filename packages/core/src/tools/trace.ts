import {tool} from 'ai';
import {z} from 'zod';
import {symbolReferenceSchema} from '@codeyantram/shared';
import type {NavigationExecutor, NavigationGraphService} from './types.js';

export const traceInputSchema = z.strictObject({
  reference: symbolReferenceSchema,
  direction: z.enum(['callers', 'callees']),
  depth: z.number().int().min(1).max(3).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  maxCharacters: z.number().int().min(2048).max(24_000).optional(),
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
