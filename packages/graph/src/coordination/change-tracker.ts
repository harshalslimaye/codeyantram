import path from 'node:path';

/** Tracks change generations so reconciliation cannot discard newer events. */
export class ChangeTracker {
  private generation = 0;
  private readonly paths = new Map<string, number>();
  private unknownChange = 0;

  constructor(private readonly workspaceRoot: string) {}

  get version(): number {return this.generation;}
  get dirty(): boolean {return this.paths.size > 0 || Boolean(this.unknownChange);}
  get pendingPaths(): string[] {return [...this.paths.keys()].sort();}
  get needsFullScan(): boolean {return Boolean(this.unknownChange);}

  record(paths: readonly string[]): string[] {
    const relative = paths.map(file => {
      if (!file.trim()) throw new Error('A changed file path is required.');
      const resolved = path.resolve(this.workspaceRoot, file);
      const name = path.relative(this.workspaceRoot, resolved);
      if (!name || name === '..' || name.startsWith(`..${path.sep}`) || path.isAbsolute(name)) {
        throw new Error('Changed files must be inside the graph workspace.');
      }
      return name.split(path.sep).join('/');
    });
    const generation = ++this.generation;
    if (!relative.length) this.unknownChange = generation;
    for (const file of relative) this.paths.set(file, generation);
    return relative;
  }

  acknowledge(generation: number): void {
    for (const [file, version] of this.paths) if (version <= generation) this.paths.delete(file);
    if (this.unknownChange <= generation) this.unknownChange = 0;
  }

  requireFullScan(): void {this.unknownChange = ++this.generation;}
}
