export type ReadErrorCode = 'invalid_input' | 'permission_denied' | 'not_found' | 'source_too_large'
  | 'unsupported_content' | 'execution_failed';

export class ReadError extends Error {
  constructor(readonly code: ReadErrorCode, message: string) {
    super(message);
    this.name = 'ReadError';
  }
}

export function mapReadError(error: unknown): ReadError {
  if (error instanceof ReadError) return error;
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new ReadError('not_found', 'The requested file was not found.');
  if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') return new ReadError('permission_denied', 'The requested file cannot be read.');
  return new ReadError('execution_failed', 'The file could not be read safely.');
}
