import {z} from 'zod';
import {navigationFilePathSchema} from '@codeyantram/shared';
import {MAX_OBJECTIVE_CHARACTERS} from '../../evaluation/index.js';
import {MAX_GIT_LOG_ENTRIES, MAX_GIT_REVISION_CHARACTERS} from './limits.js';

const query = z.string().trim().min(1).max(MAX_OBJECTIVE_CHARACTERS).optional();
const path = z.union([z.literal('.'), navigationFilePathSchema]).optional();
const filter = z.boolean().optional();

export const gitStatusInputSchema = z.strictObject({path, query, filter});
export const gitDiffInputSchema = z.strictObject({path, staged: z.boolean().optional(), query, filter});
export const gitLogInputSchema = z.strictObject({path, limit: z.number().int().min(1).max(MAX_GIT_LOG_ENTRIES).optional(), query, filter});
export const gitShowInputSchema = z.strictObject({
  revision: z.string().max(MAX_GIT_REVISION_CHARACTERS).refine(value => value === 'HEAD' || /^HEAD~[1-9][0-9]{0,2}$/.test(value)
    || /^[0-9a-fA-F]{7,64}$/.test(value)).optional(),
  query, filter,
});

export type GitStatusInput = z.infer<typeof gitStatusInputSchema>;
export type GitDiffInput = z.infer<typeof gitDiffInputSchema>;
export type GitLogInput = z.infer<typeof gitLogInputSchema>;
export type GitShowInput = z.infer<typeof gitShowInputSchema>;
