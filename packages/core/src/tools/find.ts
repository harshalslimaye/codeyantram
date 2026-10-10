import {tool} from 'ai';
import {z} from 'zod';
import type {NavigationExecutor, NavigationGraphService} from './types.js';

const MAX_QUERY_CHARACTERS = 1024;
const MAX_RESULTS = 50;
const MIN_CONTEXT_CHARACTERS = 2048;
const MAX_CONTEXT_CHARACTERS = 24_000;

export const findInputSchema = z.strictObject({
  query: z.string().min(1).max(MAX_QUERY_CHARACTERS).refine(value => Boolean(value.trim()), 'A nonblank query is required.'),
  limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
  maxCharacters: z.number().int().min(MIN_CONTEXT_CHARACTERS).max(MAX_CONTEXT_CHARACTERS).optional(),
});

export function createFindTool(service: NavigationGraphService, execute: NavigationExecutor) {
  return tool({
    description: 'Search indexed symbols and return candidates with source locations and content-backed references for inspect or trace. Choose among ambiguous matches; empty results do not prove absence. Synchronizes first.',
    inputSchema: findInputSchema,
    execute: (input, options) => execute('find', options.toolCallId, options.abortSignal, async () => {
      const result = await service.query(reader => reader.find(input.query, input), {signal: options.abortSignal});
      return {context: result.value, freshness: result.freshness};
    }),
  });
}
