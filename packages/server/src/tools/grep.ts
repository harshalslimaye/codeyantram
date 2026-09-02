import { spawn } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import { BASH_TIMEOUT_MS, resolveInProject, truncate } from './shared';

// Belt-and-suspenders on top of ripgrep's own .gitignore handling (which already
// skips .git and anything gitignored) - guarantees these are excluded even in a
// repo without a .gitignore entry for them. Must be unanchored (leading `**/`) so it
// still matches when the search target is a subdirectory, not just the search root.
const DEFAULT_EXCLUDE_GLOB = '!**/{node_modules,.git,dist,build}/**';
const DEFAULT_MAX_RESULTS = 100;

type GrepInput = {
    pattern: string;
    path: string;
    ignoreCase?: boolean;
    glob?: string;
    contextLines?: number;
    filesOnly?: boolean;
    maxResults?: number;
};

type RipgrepLineMessage = {
    type: 'match' | 'context';
    data: {
        path: { text: string };
        line_number: number;
        lines: { text: string };
    };
};

function isLineMessage(value: unknown): value is RipgrepLineMessage {
    if (typeof value !== 'object' || value === null) return false;
    const type = (value as { type?: unknown }).type;
    return type === 'match' || type === 'context';
}

// rg prefixes paths with "./" when the search target is "." - strip it so output
// paths look like every other tool's (glob, list_dir), not rg's own convention.
function normalizePath(path: string): string {
    return path.replace(/^\.\//, '');
}

/** Formats ripgrep's --json match/context messages as classic grep text: `path:line:content`
 * for a match, `path-line-content` for context, with a `--` separator between non-adjacent
 * groups. Stops once `maxResults` matches have been emitted (rg's own -m is per-file, not
 * global, so the cap is enforced here instead). */
function formatLines(stdout: string, maxResults: number): string {
    const messages = stdout
        .split('\n')
        .filter(Boolean)
        .map(line => {
            try {
                return JSON.parse(line) as unknown;
            } catch {
                return null;
            }
        })
        .filter(isLineMessage);

    const formatted: string[] = [];
    let matchCount = 0;
    let previous: { path: string; line: number } | null = null;

    for (const message of messages) {
        if (message.type === 'match') {
            if (matchCount >= maxResults) break;
            matchCount++;
        }

        const { line_number: line, lines } = message.data;
        const path = normalizePath(message.data.path.text);
        const content = lines.text.replace(/\n$/, '');
        const separator = message.type === 'match' ? ':' : '-';

        if (previous && (previous.path !== path || line !== previous.line + 1)) {
            formatted.push('--');
        }

        formatted.push(`${path}${separator}${line}${separator}${content}`);
        previous = { path, line };
    }

    if (matchCount >= maxResults) formatted.push(`… more matches truncated (maxResults=${maxResults})`);

    return formatted.join('\n');
}

/** Separate from shared.ts's runCommand - that helper joins stdout+stderr into one
 * blob for plain-text tools (bash, old grep), but ripgrep's --json stdout and any
 * stderr diagnostics need to stay apart so they can be parsed/reasoned about independently. */
function runRipgrep(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise(resolvePromise => {
        const child = spawn(rgPath, args, { cwd });
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
            resolvePromise({ stdout: '', stderr: error.message, exitCode: null });
        });

        child.on('close', exitCode => {
            clearTimeout(timer);
            resolvePromise({ stdout, stderr, exitCode });
        });
    });
}

// ripgrep's own exit-code contract: 0 = matches found, 1 = clean no-match, anything
// else (including a spawn failure, surfaced here as null) is a real error.
export async function execute(input: GrepInput, cwd: string): Promise<string> {
    // resolveInProject is used only to reject a path that escapes the project root -
    // the validated *relative* input.path (not its absolute resolution) is what gets
    // passed to rg, since --glob exclusions and output paths are both relative to the
    // search target: an absolute target breaks anchored glob matching and forces
    // absolute output paths (unlike every other tool here, which returns relative ones).
    resolveInProject(cwd, input.path);
    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;

    const args = ['--glob', DEFAULT_EXCLUDE_GLOB];
    if (input.glob) args.push('--glob', input.glob);
    if (input.ignoreCase) args.push('-i');
    if (input.contextLines) args.push('-C', String(input.contextLines));

    // --json is silently ignored by ripgrep when combined with -l (files-with-matches
    // falls back to a plain filename-per-line list), so skip it entirely in that mode
    // rather than relying on that fallback.
    if (input.filesOnly) args.push('-l');
    else args.push('--json');

    args.push('-e', input.pattern, '--', input.path);

    const { stdout, stderr, exitCode } = await runRipgrep(args, cwd);

    if (exitCode === 1) return 'No matches.';
    if (exitCode !== 0) throw new Error(stderr.trim() || `ripgrep exited with code ${exitCode}`);

    if (input.filesOnly) {
        const files = stdout.split('\n').filter(Boolean).map(normalizePath);
        const truncationNote =
            files.length > maxResults ? `\n… ${files.length - maxResults} more files truncated (maxResults=${maxResults})` : '';
        return truncate(files.slice(0, maxResults).join('\n') + truncationNote);
    }

    return truncate(formatLines(stdout, maxResults));
}
