export type GlobErrorCode = 'invalid_input' | 'permission_denied' | 'not_found' | 'execution_failed' | 'timeout';

export class GlobError extends Error {
  constructor(readonly code: GlobErrorCode, message: string) {
    super(message);
    this.name = 'GlobError';
  }
}
