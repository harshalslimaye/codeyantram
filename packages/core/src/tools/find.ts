import {tool} from 'ai';
import {z} from 'zod';
import type {NavigationExecutor, NavigationGraphService} from './types.js';

export const findInputSchema = z.strictObject({
  query: z.string().min(1).max(1024).refine(value => Boolean(value.trim()), 'A nonblank query is required.'),
  limit: z.number().int().min(1).max(50).optional(),
  maxCharacters: z.number().int().min(2048).max(24_000).optional(),
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
