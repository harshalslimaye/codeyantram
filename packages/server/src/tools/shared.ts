import { spawn } from 'node:child_process';
import { resolve, sep } from 'node:path';

export const BASH_TIMEOUT_MS = 30_000;
export const MAX_OUTPUT_CHARS = 20_000;
// edit_file loads the whole file into memory and writes it back out for even a
// one-line change, so it needs its own ceiling well below what read_file/write_file
// would otherwise allow through.
export const MAX_EDIT_FILE_BYTES = 5 * 1024 * 1024;

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
