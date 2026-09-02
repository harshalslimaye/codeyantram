import { lstat, stat } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';
import { NOISE_DIRS_GLOB, resolveInProject, truncate } from './shared';

const DEFAULT_MAX_RESULTS = 500;
// Ceiling applied whenever recursion has no explicit `depth` - fast-glob follows
// symlinked directories by default, so an unbounded depth on a circular symlink
// (a dir linking back to an ancestor) would otherwise recurse until it hits
// fast-glob's own internal limits rather than a predictable one of ours.
const DEFAULT_MAX_DEPTH = 20;

type ListDirInput = {
    path: string;
    maxResults?: number;
    includeHidden?: boolean;
    recursive?: boolean;
    depth?: number;
    withMetadata?: boolean;
};

/** Node's raw ENOTDIR/ENOENT/EACCES messages are cryptic (path repeated twice, errno
 * noise) - surface a plain sentence instead, same as read-file's binary-file check.
 * fast-glob itself stays silent (returns []) on a missing or non-directory target, so
 * this check has to happen up front rather than after the fact. */
async function assertListable(path: string, displayPath: string): Promise<void> {
    let stats;
    try {
        stats = await stat(path);
    } catch (error) {
        const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
        if (code === 'ENOENT') throw new Error(`"${displayPath}" does not exist`);
        if (code === 'EACCES') throw new Error(`Permission denied reading "${displayPath}"`);
        throw error;
    }

    if (!stats.isDirectory()) throw new Error(`"${displayPath}" is not a directory`);
}

/** fast-glob's own entry.dirent reflects the *resolved* type when it follows a symlink
 * (a symlinked directory looks like a plain directory, dropping the "this is a symlink"
 * signal entirely) - lstat the raw path to tell a symlink apart from a real file or
 * directory, which the model needs to judge before reading through one. Only paid for
 * when withMetadata is requested. */
async function describeEntry(dirPath: string, entry: fg.Entry): Promise<string> {
    const relativePath = entry.path.replace(/\/$/, '');
    const isSymlink = await lstat(join(dirPath, relativePath))
        .then(target => target.isSymbolicLink())
        .catch(() => false);

    const type = isSymlink ? 'symlink' : entry.stats?.isDirectory() ? 'dir' : 'file';
    const size = entry.stats?.size ?? 0;
    const mtime = entry.stats?.mtime.toISOString() ?? '';

    return `${entry.path}\t${type}\t${size}\t${mtime}`;
}

export async function execute(input: ListDirInput, cwd: string): Promise<string> {
    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
    const recursive = input.recursive === true || input.depth !== undefined;
    const dirPath = resolveInProject(cwd, input.path);

    await assertListable(dirPath, input.path);

    const pattern = recursive ? '**' : '*';
    const options = {
        cwd: dirPath,
        onlyFiles: false,
        markDirectories: true,
        dot: input.includeHidden === true,
        deep: recursive ? (input.depth ?? DEFAULT_MAX_DEPTH) : 1,
        // node_modules/.git/dist/build are only pruned while descending recursively -
        // a flat top-level listing can still show e.g. "node_modules/" as one entry,
        // which isn't the noise problem recursion has (thousands of nested files).
        ignore: recursive ? [NOISE_DIRS_GLOB] : [],
    };

    // stats:true costs an extra stat() per entry, so it's only requested when the
    // caller actually wants size/mtime/type - a plain listing skips it entirely.
    const names = input.withMetadata
        ? (await Promise.all((await fg(pattern, { ...options, stats: true })).map(entry => describeEntry(dirPath, entry)))).sort()
        : (await fg(pattern, options)).sort();

    const truncationNote =
        names.length > maxResults ? `\n… ${names.length - maxResults} more entries truncated (maxResults=${maxResults})` : '';

    return truncate(names.slice(0, maxResults).join('\n') + truncationNote);
}
