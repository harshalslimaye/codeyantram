import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const BASH_TIMEOUT_MS = 30_000;
export const MAX_OUTPUT_CHARS = 20_000;
// edit_file loads the whole file into memory and writes it back out for even a
// one-line change, so it needs its own ceiling well below what read_file/write_file
// would otherwise allow through.
export const MAX_EDIT_FILE_BYTES = 5 * 1024 * 1024;
// read_file streams a file in chunks instead of buffering it, so this is a budget on
// how far it will scan looking for the requested lines - not a limit on how big a file
// it can open. Reaching a line past this much data belongs in bash (sed -n) instead.
export const MAX_READ_FILE_BYTES = 16 * 1024 * 1024;

/** Directories skipped even without a .gitignore entry for them - shared by grep (as a
 * ripgrep `!`-prefixed --glob exclusion) and list_dir (as a fast-glob `ignore` pattern).
 * Must be unanchored (leading `**\/`) so it still matches when the search/list target is
 * a subdirectory, not just the project root. */
export const NOISE_DIRS_GLOB = '**/{node_modules,.git,dist,build}/**';

/** Every tool's path input is relative to `cwd` - this is what keeps a tool call from reaching outside the project it was invoked in. */
export function resolveInProject(cwd: string, relativePath: string): string {
    const root = resolve(cwd);
    const resolved = resolve(root, relativePath);

    if (resolved !== root && !resolved.startsWith(root + sep)) {
        throw new Error(`"${relativePath}" resolves outside the project root`);
    }

    return resolved;
}

/** resolveInProject only compares path strings, so a symlink *inside* the project that
 * points outside it (project/link -> /etc/passwd) clears that check and still reads out
 * of the jail. This resolves both sides with realpath and re-runs the containment check
 * against the real paths. The root has to be resolved too, since it can itself sit under
 * a symlinked ancestor (on macOS /var -> /private/var) - comparing a real target against
 * a lexical root would otherwise reject every path on such a machine. */
export async function resolveRealInProject(cwd: string, relativePath: string): Promise<string> {
    const target = resolveInProject(cwd, relativePath);
    const realRoot = await realpath(resolve(cwd));
    // A path that won't resolve doesn't exist (or isn't reachable), which is the
    // caller's own stat/open to report - with a message naming the path it was given,
    // rather than whatever realpath's errno says.
    const realTarget = await realpath(target).catch(() => null);

    if (realTarget !== null && realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
        throw new Error(`"${relativePath}" resolves outside the project root through a symlink`);
    }

    return target;
}

export function truncate(output: string): string {
    return output.length > MAX_OUTPUT_CHARS ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n… truncated` : output;
}

/** Uses node:child_process rather than Bun.spawn so the built server can run under plain Node.js - only `bun run dev` and the test runner need to be Bun. */
export function runCommand(command: [string, ...string[]], cwd: string): Promise<string> {
    const [executable, ...args] = command;

    return new Promise(resolvePromise => {
        const child = spawn(executable, args, { cwd });
        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => child.kill(), BASH_TIMEOUT_MS);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf-8');
        });

        child.on('error', error => {
            clearTimeout(timer);
            resolvePromise(`Error: ${error.message}`);
        });

        child.on('close', () => {
            clearTimeout(timer);
            resolvePromise(truncate([stdout, stderr].filter(Boolean).join('\n').trim()));
        });
    });
}
