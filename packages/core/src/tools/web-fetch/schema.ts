import {z} from 'zod';
import {MAX_TIMEOUT_SECONDS, MAX_URL_CHARACTERS} from './limits.js';

const MAX_QUERY_CHARACTERS = 2048;

export const webFetchInputSchema = z.strictObject({
  url: z.string().min(1).max(MAX_URL_CHARACTERS),
  format: z.enum(['markdown', 'text', 'html']).optional(),
  timeout: z.number().int().min(1).max(MAX_TIMEOUT_SECONDS).optional(),
  query: z.string().trim().min(1).max(MAX_QUERY_CHARACTERS).optional(),
  filter: z.boolean().optional(),
});
export type WebFetchInput = z.infer<typeof webFetchInputSchema>;
