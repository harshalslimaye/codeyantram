import {z} from 'zod';
import {navigationFilePathSchema} from '@codeyantram/shared';
import {MAX_PATCH_CHARACTERS, MAX_PATCH_FILES} from './limits.js';

export const applyPatchInputSchema = z.strictObject({
  patchText: z.string().min(1).max(MAX_PATCH_CHARACTERS).refine(value => !value.includes('\0')),
  expectedHashes: z.record(navigationFilePathSchema, z.string().regex(/^[a-f0-9]{64}$/))
    .refine(value => Object.keys(value).length <= MAX_PATCH_FILES),
});

export type ApplyPatchInput = z.infer<typeof applyPatchInputSchema>;
