// In-memory undo history for edit_file, keyed by resolved absolute path. Lives only for the
// life of the server process - not written to disk, and not shared across server instances.
// That's enough to recover from a bad edit_file call within a session without relying on the
// user having version control set up.

const MAX_BACKUPS_PER_PATH = 20;

const backups = new Map<string, string[]>();

/** Records `content` as the state to restore to if this path's next edit is undone. */
export function pushBackup(path: string, content: string): void {
    const stack = backups.get(path) ?? [];
    stack.push(content);

    if (stack.length > MAX_BACKUPS_PER_PATH) stack.shift();

    backups.set(path, stack);
}

/** Pops and returns the most recent backup for `path`, or undefined if there isn't one. */
export function popBackup(path: string): string | undefined {
    const stack = backups.get(path);
    if (stack === undefined || stack.length === 0) return undefined;

    const content = stack.pop();
    if (stack.length === 0) backups.delete(path);

    return content;
}
