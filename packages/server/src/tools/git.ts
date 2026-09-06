import { spawn } from 'node:child_process';
import type { GitSubcommand } from '@codeyantram/shared';
import { BASH_TIMEOUT_MS, MAX_OUTPUT_CHARS, truncate } from './shared';

type GitInput = {
    command: GitSubcommand;
    args?: string[];
};

// The one option that has to be refused: --output redirects what would be returned here
// into a file on disk instead, and it's the only way any of the allowed subcommands
// writes anything at all. Its short form -o is deliberately *not* listed - git doesn't
// accept -o as --output for any of these, while `ls-files -o` means --others (list
// untracked files), so denying it would break a legitimate read.
//
// The options that could re-root git somewhere else entirely (-C, --git-dir,
// --work-tree, -c, --exec-path) don't need listing either: they're global options, legal
// only *before* the subcommand, and every argument here lands after it, so git rejects
// them on its own. Naming them would instead break the per-command options that share
// those spellings (`log -c`, `diff -C`).
const FILE_WRITING_OPTIONS: readonly string[] = ['--output', '--output-directory'];

/** `--exit-code`/`--quiet` turn `git diff` into a question: exit 1 means "yes, there are
 * differences", which is an answer rather than a failure. */
const DIFF_EXIT_CODE_OPTIONS: readonly string[] = ['--exit-code', '--quiet'];

function optionName(arg: string): string {
    const equals = arg.indexOf('=');
    return equals === -1 ? arg : arg.slice(0, equals);
}

/** The subcommand allowlist in GIT_READ_ONLY_SUBCOMMANDS is what makes this tool
 * read-only - none of the ten has a writing mode, so there are no per-subcommand rules
 * here to drift out of step with git. That leaves only the option that would still put
 * something on disk. Scanning stops at `--`, after which everything is a pathspec, which
 * can only ever narrow what a command reads.
 *
 * Throws rather than returning, so buildProjectTools' wrapper reports it as an error -
 * with a message naming the alternative, since the model sees it as the tool result and
 * can correct itself in the same turn. */
export function assertReadOnly(command: GitSubcommand, args: readonly string[]): void {
    for (const arg of args) {
        if (arg === '--') return;
        if (!arg.startsWith('-')) continue;

        const option = optionName(arg);
        if (FILE_WRITING_OPTIONS.includes(option)) {
            throw new Error(`git ${command} ${option} writes its output to a file instead of returning it - drop it, or use bash if the file is the point`);
        }
    }
}

type GitOutcome = {
    output: string;
    exitCode: number | null;
    timedOut: boolean;
};

/** Separate from shared.ts's runCommand for the same reason grep has its own runner:
 * that helper drops the exit code, and here the exit code is what tells `git diff
 * --quiet` (1 = there are changes) apart from a real failure, and a fatal git error
 * apart from ordinary output. */
function runGit(args: string[], cwd: string): Promise<GitOutcome> {
    return new Promise(resolvePromise => {
        const child = spawn('git', args, {
            cwd,
            // No stdin: a subcommand that would otherwise wait on input (shortlog with no
            // revision) finishes immediately instead of hanging the turn.
            // GIT_TERMINAL_PROMPT stops git asking for credentials the same way, and a
            // pager would only ever mangle output that's being read as text.
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const finish = (outcome: Omit<GitOutcome, 'output'>) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            // Trailing whitespace only: leading whitespace is *content* here, since git
            // aligns output in columns (`status --short` reserves a column per side of
            // the index), and trimming the front would silently reflow the first line.
            resolvePromise({ output: [stdout, stderr].filter(Boolean).join('\n').replace(/\s+$/, ''), ...outcome });
        };

        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            finish({ exitCode: null, timedOut: true });
        }, BASH_TIMEOUT_MS);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
            // `git log -p` over a large history can run to hundreds of megabytes; stop it
            // once we're well past anything that could be returned, rather than buffering
            // the whole thing only to throw most of it away.
            if (stdout.length + stderr.length > MAX_OUTPUT_CHARS * 2) child.kill('SIGTERM');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf-8');
        });

        child.on('error', error => {
            stderr += `\n${error.message}`;
            finish({ exitCode: null, timedOut: false });
        });

        child.on('close', exitCode => {
            finish({ exitCode, timedOut: false });
        });
    });
}

export async function execute(input: GitInput, cwd: string): Promise<string> {
    const args = input.args ?? [];
    assertReadOnly(input.command, args);

    // Both are global options, so they go before the subcommand. --no-optional-locks
    // keeps `git status` from writing its refreshed index back to .git, which is what
    // makes even that subcommand read-only in the literal sense; --no-pager is
    // belt-and-braces on top of the GIT_PAGER above.
    const outcome = await runGit(['--no-pager', '--no-optional-locks', input.command, ...args], cwd);
    const output = truncate(outcome.output);

    if (outcome.timedOut) {
        return `Error: git ${input.command} timed out after ${BASH_TIMEOUT_MS / 1000}s${output ? `\n${output}` : ''}`;
    }

    if (outcome.exitCode !== 0) {
        if (/not a git repository/i.test(outcome.output)) {
            return 'Error: the project root is not inside a git repository';
        }
        // The question form of `git diff`, where exit 1 is the answer "yes, there are
        // differences" - reporting it as an error would invert what it found.
        if (input.command === 'diff' && outcome.exitCode === 1 && args.some(arg => DIFF_EXIT_CODE_OPTIONS.includes(optionName(arg)))) {
            return output || 'Differences found (exit 1).';
        }
        if (outcome.exitCode === null) return `Error: ${output || 'git could not be run'}`;
        return `Error (exit ${outcome.exitCode}): ${output || '(no output)'}`;
    }

    return output || '(no output)';
}
