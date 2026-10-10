import {z} from 'zod';

const MAX_FILE_PATH_CHARACTERS = 1024;
const MAX_SYMBOL_ID_CHARACTERS = 256;

/** Portable relative paths; roots and traversal are never model arguments. */
export const navigationFilePathSchema = z.string().min(1).max(MAX_FILE_PATH_CHARACTERS).refine(value =>
  !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
  && value.split('/').every(segment => Boolean(segment) && segment !== '.' && segment !== '..'),
{message: 'Use a normalized workspace-relative file path.'});

/** Bound to a workspace and exact file content, independent of observation revisions. */
export const symbolReferenceSchema = z.strictObject({
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  symbolId: z.string().min(1).max(MAX_SYMBOL_ID_CHARACTERS),
  filePath: navigationFilePathSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type SymbolReference = z.infer<typeof symbolReferenceSchema>;
