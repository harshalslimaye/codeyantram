import type {GraphCoordinatorStatus} from '../contracts/coordination.js';
import {GraphCoordinatorError} from './errors.js';

type Operation = GraphCoordinatorStatus['operation'];

/** Serializes workspace operations and owns admission and shutdown draining. */
export class OperationQueue {
  private tail: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private current: Operation = 'idle';
  private pending = 0;

  get operation(): Operation {return this.current;}
  get pendingOperations(): number {return this.pending;}

  assertOpen(): void {
    if (this.closing) throw new GraphCoordinatorError('closed', 'The graph coordinator is closing or closed.');
  }

  setOperation(operation: Operation): void {
    if (!this.closing) this.current = operation;
  }

  enqueue<T>(operation: Operation, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {this.assertOpen();} catch (error) {return Promise.reject(error);}
    this.pending++;
    const result = this.tail.then(async () => {
      try {
        signal?.throwIfAborted();
        this.setOperation(operation);
        return await run();
      } finally {
        this.pending--;
        this.setOperation('idle');
      }
    });
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  close(closeBackend: () => Promise<void>): Promise<void> {
    if (!this.closing) {
      this.current = 'closing';
      this.closing = this.tail.then(async () => {
        try {await closeBackend();} finally {this.current = 'closed';}
      });
    }
    return this.closing;
  }
}
