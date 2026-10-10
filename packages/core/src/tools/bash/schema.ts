import {z} from 'zod';
import {navigationFilePathSchema} from '@codeyantram/shared';
import {MAX_COMMAND_CHARACTERS, MAX_COMMAND_TIMEOUT_MS} from './limits.js';

export const bashInputSchema = z.strictObject({
  command: z.string().min(1).max(MAX_COMMAND_CHARACTERS).refine(value => value.trim() !== '' && !value.includes('\0')),
  workdir: z.union([z.literal('.'), navigationFilePathSchema]).optional(),
  timeoutMs: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_MS).optional(),
});

export type BashInput = z.infer<typeof bashInputSchema>;
