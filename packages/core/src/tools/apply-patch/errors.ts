export type ApplyPatchErrorCode = 'invalid_input' | 'permission_denied' | 'not_found' | 'source_too_large'
  | 'unsupported_content' | 'stale_reference' | 'execution_failed';

export class ApplyPatchError extends Error {
  constructor(readonly code: ApplyPatchErrorCode, message: string) {
    super(message);
    this.name = 'ApplyPatchError';
  }
}

export function mapPatchError(error: unknown): ApplyPatchError {
  if (error instanceof ApplyPatchError) return error;
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new ApplyPatchError('not_found', 'The file or parent directory was not found.');
  if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') return new ApplyPatchError('permission_denied', 'The patch target cannot be accessed safely.');
  return new ApplyPatchError('execution_failed', 'The patch could not complete safely. Re-read every target before retrying.');
}
