import type {BashApprovalRequest, BashApprover, PatchApprovalRequest, PatchApprover} from '@codeyantram/core';

export type ApprovalItem = {id: number; kind: 'patch'; request: PatchApprovalRequest} |
  {id: number; kind: 'command'; request: BashApprovalRequest};

interface QueuedApproval {
  item: ApprovalItem;
  resolve: (approved: boolean) => void;
  signal?: AbortSignal;
  abort: () => void;
}

/** Owns exact pending requests and serializes decisions across both mutation tools. */
export class ApprovalController {
  private queue: QueuedApproval[] = [];
  private listeners = new Set<() => void>();
  private closed = false;
  private nextId = 0;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };

  readonly getSnapshot = (): ApprovalItem | undefined => this.queue[0]?.item;

  readonly approvePatch: PatchApprover = (request, signal) => this.enqueue({kind: 'patch', request}, signal);
  readonly approveCommand: BashApprover = (request, signal) => this.enqueue({kind: 'command', request}, signal);

  decide(id: number, approved: boolean): void {
    if (this.queue[0]?.item.id !== id) return;
    this.resolveAt(0, approved);
  }

  close(): void {
    this.closed = true;
    while (this.queue.length > 0) this.resolveAt(0, false);
  }

  private enqueue(entry: {kind: 'patch'; request: PatchApprovalRequest} |
    {kind: 'command'; request: BashApprovalRequest}, signal?: AbortSignal): Promise<boolean> {
    if (this.closed || signal?.aborted === true) return Promise.resolve(false);
    return new Promise(resolve => {
      const item = {...entry, id: ++this.nextId} as ApprovalItem;
      const queued: QueuedApproval = {item, resolve, signal, abort: () => {
        const index = this.queue.indexOf(queued);
        if (index !== -1) this.resolveAt(index, false);
      }};
      this.queue.push(queued);
      signal?.addEventListener('abort', queued.abort, {once: true});
      this.notify();
    });
  }

  private resolveAt(index: number, approved: boolean): void {
    const [entry] = this.queue.splice(index, 1);
    if (entry === undefined) return;
    entry.signal?.removeEventListener('abort', entry.abort);
    entry.resolve(approved);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
