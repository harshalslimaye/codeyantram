import {WorkspacePathError} from '../workspace/paths.js';

export class BashError extends Error {
  constructor(readonly code: 'invalid_input' | 'permission_denied' | 'not_found' | 'execution_failed', message: string) {
    super(message);
    this.name = 'BashError';
  }
}

export function mapBashError(error: unknown): BashError {
  if (error instanceof BashError || error instanceof WorkspacePathError) return new BashError(error.code, error.message);
  return new BashError('execution_failed', 'Command execution failed. Side effects may have occurred; inspect the workspace before retrying.');
}
