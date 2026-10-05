import {openWorkspaceGraph} from '../workspace/graph.js';
import {GraphCoordinator} from './coordinator.js';
import type {CoordinatedGraph} from '../contracts/graph.js';
import {resolveGraphStoragePaths} from '../storage/paths.js';

export interface GraphCoordinatorLease {
  coordinator: GraphCoordinator;
  /** Release this lease once; the last release drains and closes the workspace. */
  release(): Promise<void>;
}

interface Entry {
  opening: Promise<GraphCoordinator>;
  references: number;
  closing?: Promise<void>;
}

/** One coordinator per canonical workspace, shared by host-owned leases. */
export class WorkspaceGraphRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly open: (root: string) => Promise<CoordinatedGraph> = openWorkspaceGraph) {}

  async acquire(workspaceRoot: string): Promise<GraphCoordinatorLease> {
    const storage = await resolveGraphStoragePaths(workspaceRoot);
    const key = storage.workspaceId;
    let entry: Entry;
    for (;;) {
      const existing = this.entries.get(key);
      if (existing?.closing) {
        await existing.closing;
        continue;
      }
      if (existing) {entry = existing; break;}
      entry = {opening: Promise.resolve().then(() => this.open(storage.workspaceRoot))
        .then(graph => new GraphCoordinator(graph)), references: 0};
      this.entries.set(key, entry);
      break;
    }
    entry.references++;
    let coordinator: GraphCoordinator;
    try {coordinator = await entry.opening;}
    catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
    let released: Promise<void> | undefined;
    return {coordinator, release: () => {
      if (released) return released;
      if (--entry.references > 0) return released = Promise.resolve();
      entry.closing = coordinator.close().finally(() => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      });
      return released = entry.closing;
    }};
  }
}

const workspaces = new WorkspaceGraphRegistry();
export const acquireGraphCoordinator = (workspaceRoot: string): Promise<GraphCoordinatorLease> => workspaces.acquire(workspaceRoot);
