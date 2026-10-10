export type GrepErrorCode = 'invalid_input' | 'permission_denied' | 'not_found' | 'execution_failed' | 'timeout';

export class GrepError extends Error {
  constructor(readonly code: GrepErrorCode, message: string) {
    super(message);
    this.name = 'GrepError';
  }
}

export function mapGrepError(error: unknown): GrepError {
  if (error instanceof GrepError) return error;
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new GrepError('not_found', 'The search path was not found.');
  if (code === 'EACCES' || code === 'EPERM') return new GrepError('permission_denied', 'The search path cannot be accessed.');
  return new GrepError('execution_failed', 'Workspace search could not complete safely.');
}
