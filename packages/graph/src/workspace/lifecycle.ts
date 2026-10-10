import type {LifecycleBackend} from '../sdk/ports.js';

/** Owns admission and drains asynchronous operations before closing the backend. */
export class WorkspaceLifecycle {
  private closing?: Promise<void>;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly backend: LifecycleBackend) {}

  private assertOpen(): void {
    if (this.closing) throw new Error('The workspace graph is closing or closed.');
  }

  assertQueryable(): void {
    this.assertOpen();
    if (this.backend.isIndexing()) throw new Error('The workspace graph is indexing. Wait for indexing to complete.');
    // Refresh reads after another process updates or replaces the index.
    this.backend.reopenIfReplaced();
    this.backend.dropReadCaches();
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const pending = operation();
    this.pending.add(pending);
    void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending));
    return pending;
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      await Promise.allSettled(this.pending);
      this.backend.close();
    })();
  }
}
