export class GraphSourceChangedError extends Error {
  constructor() {
    super('Source changed while graph context was being assembled. Retry explore.');
    this.name = 'GraphSourceChangedError';
  }
}

export class GraphNavigationError extends Error {
  constructor(
    readonly code: 'stale_reference' | 'not_found' | 'invalid_input' | 'source_too_large' | 'execution_failed',
    message: string,
  ) {
    super(message);
    this.name = 'GraphNavigationError';
  }
}
