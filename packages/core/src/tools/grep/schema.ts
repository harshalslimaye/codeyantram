import {z} from 'zod';
import {navigationFilePathSchema} from '@codeyantram/shared';
import {MAX_OBJECTIVE_CHARACTERS} from '../../evaluation/index.js';
import {MAX_MATCH_LIMIT, MAX_PATTERN_CHARACTERS} from './limits.js';

export const grepInputSchema = z.strictObject({
  pattern: z.string().min(1).max(MAX_PATTERN_CHARACTERS).refine(value => !/[\0\r\n]/.test(value)),
  path: z.union([z.literal('.'), navigationFilePathSchema]).optional(),
  include: z.string().min(1).max(MAX_PATTERN_CHARACTERS).refine(value => !/[\0\r\n]/.test(value)).optional(),
  fixedStrings: z.boolean().optional(),
  ignoreCase: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_MATCH_LIMIT).optional(),
  query: z.string().trim().min(1).max(MAX_OBJECTIVE_CHARACTERS).optional(),
  filter: z.boolean().optional(),
});
export type GrepInput = z.infer<typeof grepInputSchema>;
