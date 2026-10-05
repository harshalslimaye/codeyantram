import {z} from 'zod';

/** Portable relative paths; roots and traversal are never model arguments. */
export const navigationFilePathSchema = z.string().min(1).max(1024).refine(value =>
  !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
  && value.split('/').every(segment => Boolean(segment) && segment !== '.' && segment !== '..'),
{message: 'Use a normalized workspace-relative file path.'});

/** Bound to a workspace and exact file content, independent of observation revisions. */
export const symbolReferenceSchema = z.strictObject({
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  symbolId: z.string().min(1).max(256),
  filePath: navigationFilePathSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type SymbolReference = z.infer<typeof symbolReferenceSchema>;
