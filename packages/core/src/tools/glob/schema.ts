import {z} from 'zod';
import {navigationFilePathSchema} from '@codeyantram/shared';
import {MAX_OBJECTIVE_CHARACTERS} from '../../evaluation/index.js';
import {MAX_FILE_LIMIT, MAX_PATTERN_CHARACTERS} from './limits.js';

export const globInputSchema = z.strictObject({
  pattern: z.string().min(1).max(MAX_PATTERN_CHARACTERS).refine(value => !/[\0\r\n]/.test(value)),
  path: z.union([z.literal('.'), navigationFilePathSchema]).optional(),
  ignoreCase: z.boolean().optional(),
  hidden: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_FILE_LIMIT).optional(),
  query: z.string().trim().min(1).max(MAX_OBJECTIVE_CHARACTERS).optional(),
  filter: z.boolean().optional(),
});
export type GlobInput = z.infer<typeof globInputSchema>;
