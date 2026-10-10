import {z} from 'zod';
import {navigationFilePathSchema} from '@codeyantram/shared';
import {MAX_OBJECTIVE_CHARACTERS} from '../../evaluation/index.js';
import {MAX_READ_CHARACTERS, MAX_READ_LINES} from './limits.js';

export const readInputSchema = z.strictObject({
  filePath: navigationFilePathSchema,
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(MAX_READ_LINES).optional(),
  maxCharacters: z.number().int().min(1).max(MAX_READ_CHARACTERS).optional(),
  query: z.string().trim().min(1).max(MAX_OBJECTIVE_CHARACTERS).optional(),
  filter: z.boolean().optional(),
});

export type ReadInput = z.infer<typeof readInputSchema>;
