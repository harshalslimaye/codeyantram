export class GitError extends Error {
  constructor(readonly code: 'invalid_input' | 'not_found' | 'timeout' | 'execution_failed', message: string) {
    super(message);
    this.name = 'GitError';
  }
}
