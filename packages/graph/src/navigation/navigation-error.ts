export class GraphNavigationError extends Error {
  constructor(
    readonly code: 'stale_reference' | 'not_found' | 'invalid_input' | 'source_too_large' | 'execution_failed',
    message: string,
  ) {
    super(message);
    this.name = 'GraphNavigationError';
  }
}
