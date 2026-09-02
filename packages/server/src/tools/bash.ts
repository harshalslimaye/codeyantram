import { spawn, spawnSync } from 'node:child_process';
import { BASH_TIMEOUT_MS, MAX_OUTPUT_CHARS, truncate } from './shared';

const SIGKILL_GRACE_MS = 3_000;

// Soft resource caps applied inside the shell via `ulimit` before the real
// command runs. These are bash builtins, not a real sandbox - they stop an
// accidental fork bomb or memory blowup but do nothing to confine
// filesystem or network access. Real confinement is the bwrap layer below.
// The virtual-memory cap is set well above what a single script needs
// because V8 (node/bun) reserves large virtual address space up front
// regardless of actual usage - a tight cap here aborts tsc/bun with an
// OOM crash on a completely healthy command.
//
// -v and -u are skipped on macOS: Darwin's kernel rejects RLIMIT_AS outright
// (`ulimit -v` errors on every call), and RLIMIT_NPROC there counts all
// processes owned by the user across the whole machine, not this process
// tree - a desktop routinely has 500+ already, so a 256 cap makes every
// subsequent fork() in the shell fail immediately with EAGAIN, breaking
// `which`, `git`, and everything else. -t and -f are per-process and safe
// on both platforms.
const ULIMIT_PREFIX = [
    ...(process.platform === 'darwin'
        ? []
        : ['ulimit -v 4194304', 'ulimit -u 256']), // 4 GB virtual memory; cap concurrent processes
    'ulimit -t 30', // 30s CPU time
    'ulimit -f 102400', // ~100MB max file size written
].join('; ');

// Defense in depth, not a security boundary - shell syntax has too many
// ways to express the same intent (`$(...)`, base64 | decode | sh, etc).
// Real containment is the bwrap sandbox + resource limits below; this just
// catches the obvious, common cases before we even spawn anything.
const DENYLIST_PATTERNS: RegExp[] = [
    /\brm\s+-rf\s+\/(?:\s|$)/, // rm -rf /
    /\bmkfs\b/,
    /\bdd\s+.*of=\/dev\//,
    /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // classic fork bomb
    />\s*\/dev\/sd[a-z]/,
];

function isDenylisted(command: string): string | null {
    for (const pattern of DENYLIST_PATTERNS) {
        if (pattern.test(command)) return pattern.source;
    }
    return null;
}

// Detected once and cached: if bubblewrap is on PATH we run the command in
// a namespace that only sees the project directory read-write and a
// read-only view of the base OS, with networking and the host PID
// namespace unshared. Without bwrap installed, we fall back to plain bash
// with just the ulimits above - NOT a sandbox, only a resource cap.
let bwrapAvailable: boolean | null = null;
function hasBubblewrap(): boolean {
    if (bwrapAvailable === null) {
        try {
            bwrapAvailable = spawnSync('bwrap', ['--version'], { stdio: 'ignore' }).status === 0;
        } catch {
            bwrapAvailable = false;
        }
    }
    return bwrapAvailable;
}

function buildCommand(command: string, cwd: string): [string, ...string[]] {
    const shellCommand = `${ULIMIT_PREFIX}; ${command}`;

    if (hasBubblewrap()) {
        return [
            'bwrap',
            '--ro-bind', '/usr', '/usr',
            '--ro-bind', '/bin', '/bin',
            '--ro-bind', '/lib', '/lib',
            '--ro-bind-try', '/lib64', '/lib64',
            '--ro-bind-try', '/etc/resolv.conf', '/etc/resolv.conf',
            '--bind', cwd, cwd,
            '--chdir', cwd,
            '--unshare-net',
            '--unshare-pid',
            '--die-with-parent',
            '--proc', '/proc',
            '--dev', '/dev',
            'bash', '-c', shellCommand,
        ];
    }

    return ['bash', '-c', shellCommand];
}

type CommandOutcome = {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
};

function runSandboxedCommand(command: [string, ...string[]], cwd: string): Promise<CommandOutcome> {
    const [executable, ...args] = command;

    return new Promise(resolvePromise => {
        const child = spawn(executable, args, {
            cwd,
            detached: true, // own process group, so a timeout/limit kill takes the whole tree with it
            stdio: ['ignore', 'pipe', 'pipe'], // no stdin - a command waiting on input fails fast instead of hanging
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;

        const killGroup = (signal: NodeJS.Signals) => {
            if (child.pid === undefined) return;
            try {
                process.kill(-child.pid, signal); // negative pid = whole process group, not just the direct child
            } catch {
                child.kill(signal); // group already gone, or we lack permission - fall back to the direct child
            }
        };

        const termTimer = setTimeout(() => {
            timedOut = true;
            killGroup('SIGTERM');
        }, BASH_TIMEOUT_MS);

        // If SIGTERM didn't finish the job, escalate - some processes ignore it.
        const killTimer = setTimeout(() => {
            if (!settled) killGroup('SIGKILL');
        }, BASH_TIMEOUT_MS + SIGKILL_GRACE_MS);

        const finish = (outcome: Omit<CommandOutcome, 'stdout' | 'stderr'>) => {
            if (settled) return;
            settled = true;
            clearTimeout(termTimer);
            clearTimeout(killTimer);
            resolvePromise({ stdout, stderr, ...outcome });
        };

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
            // Stop the bleeding as soon as we're well past what we'll ever
            // return, rather than buffering unbounded output until the
            // process eventually exits on its own.
            if (stdout.length + stderr.length > MAX_OUTPUT_CHARS * 2) killGroup('SIGTERM');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf-8');
        });

        child.on('error', error => {
            stderr += `\n${error.message}`;
            finish({ exitCode: null, signal: null, timedOut: false });
        });

        child.on('close', (code, signal) => {
            finish({ exitCode: code, signal, timedOut });
        });
    });
}

function formatOutcome(outcome: CommandOutcome): string {
    const combined = truncate([outcome.stdout, outcome.stderr].filter(Boolean).join('\n').trim());

    if (outcome.timedOut) {
        return `Error: command timed out after ${BASH_TIMEOUT_MS / 1000}s${combined ? `\n${combined}` : ''}`;
    }
    if (outcome.exitCode !== null && outcome.exitCode !== 0) {
        return `Error (exit ${outcome.exitCode}): ${combined || '(no output)'}`;
    }
    if (outcome.signal) {
        return `Error (killed by ${outcome.signal}): ${combined || '(no output)'}`;
    }
    return combined || '(no output)';
}

export async function execute(input: { command: string }, cwd: string): Promise<string> {
    const violated = isDenylisted(input.command);
    if (violated) {
        return `Error: command blocked by safety policy (matched pattern: ${violated})`;
    }

    const outcome = await runSandboxedCommand(buildCommand(input.command, cwd), cwd);
    return formatOutcome(outcome);
}
