import { spawn } from 'node:child_process';
import { lstat, readlink, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

export const BASH_TIMEOUT_MS = 30_000;
// Halved from its original 20_000: a single read/command result was costing up to ~5,500
// tokens, replayed on every later step and turn of the session once it lands in history
// (see prompt-cache.ts's own comment on that same cost). 10_000 still comfortably covers a
// typical file window or command output; a genuinely large read already pages via
// offset/limit rather than depending on one huge result.
export const MAX_OUTPUT_CHARS = 10_000;
/** What one worker may hand back, enforced in the executor rather than asked for in its
 * prompt - a prompt-only limit is a request, and a small model will exceed it. Two orders
 * of magnitude under MAX_OUTPUT_CHARS on purpose: a worker exists to return a handful of
 * cited lines, and anything approaching a raw tool result means it has stopped
 * summarizing. */
export const MAX_SUBAGENT_OUTPUT_CHARS = 2_000;
/**
 * How many model calls one worker gets before its loop is cut off (see MAX_TOOL_STEPS in
 * chat-stream.ts for the orchestrator's own, much larger, budget).
 *
 * Four, not six. A locate-and-cite task finishes in three - search, look, report - and the
 * fourth is room for one wrong first guess. This is the tightest of the three caps on
 * purpose, because a worker's steps are what a turn actually *waits* on: each one is a full
 * provider round trip with nothing streaming to the user meanwhile, so every extra step
 * allowed is seconds of silence bought for a worker that is, by this point, lost. Each step
 * also re-sends everything the worker has accumulated, so its cost grows faster than the
 * count suggests.
 *
 * Raising this is the wrong fix for a worker that runs out of steps - the task string was
 * too vague, or the answer needs two workers rather than one.
 */
export const MAX_SUBAGENT_STEPS = 4;
/**
 * How many workers one turn may spawn in total, across every worker type.
 *
 * Not derivable from the two step caps, which is the thing to understand before touching
 * it: a step is one model call *plus every tool call that came back with it*, so parallel
 * spawns all land inside a single step and `stepCountIs` never sees them. It bounds the
 * depth of one loop and says nothing about how many loops run beside it - each worker
 * starts its own step count at zero. Without this, one turn could spawn an unbounded
 * number of workers: 15 orchestrator steps x however many the model emits per step.
 *
 * Per turn rather than per step, and shared rather than per worker type, because a turn is
 * one user message - which is the unit an unexpected bill actually shows up in.
 *
 * A typical locate-and-report turn spends one to four, so this only ever binds on a
 * runaway - the same role MAX_TOOL_STEPS plays.
 */
export const MAX_SUBAGENT_SPAWNS_PER_TURN = 10;
// edit_file loads the whole file into memory and writes it back out for even a
// one-line change, so it needs its own ceiling well below what read_file/write_file
// would otherwise allow through.
export const MAX_EDIT_FILE_BYTES = 5 * 1024 * 1024;
// read_file streams a file in chunks instead of buffering it, so this is a budget on
// how far it will scan looking for the requested lines - not a limit on how big a file
// it can open. Reaching a line past this much data belongs in bash (sed -n) instead.
export const MAX_READ_FILE_BYTES = 16 * 1024 * 1024;
// write_file buffers the whole content in memory and hands it to a single write(), so it
// gets the same ceiling as edit_file. Anything larger belongs in bash (a redirect, or a
// stream) rather than being passed through a tool call as one string.
export const MAX_WRITE_FILE_BYTES = 5 * 1024 * 1024;
/** How many *missing* parent directories one write_file call may create. A real path is
 * a level or two deep at most; a long chain of nonexistent directories is almost always a
 * malformed or hallucinated path, and mkdir -p would happily materialize the whole thing. */
export const MAX_NEW_DIR_DEPTH = 5;
/** Ceiling on total path depth, as a sanity check against a pathological path (a repeated
 * segment, a runaway join) that stays inside the root and so clears every other check. */
export const MAX_PATH_SEGMENTS = 40;
/** How much of a file's head is enough to tell text from binary - both read_file (before
 * decoding it) and write_file (before diffing what it's about to destroy) sniff this much. */
export const BINARY_SAMPLE_BYTES = 8192;
// web_fetch buffers the response body in memory (there's no offset/limit into raw bytes -
// paging happens later, over the converted text), so it gets the same 5 MB ceiling as
// write_file/edit_file. Counted post-decompression: fetch() decompresses transparently, so
// this is a real ceiling on decoded size, not on bytes over the wire.
export const MAX_WEB_FETCH_BYTES = 5 * 1024 * 1024;
// Covers connect + the whole body, same ceiling as BASH_TIMEOUT_MS - a fetch that hasn't
// finished by then is aborted rather than left to hang the turn.
export const WEB_FETCH_TIMEOUT_MS = 30_000;
/** A real redirect chain is rarely more than one or two hops; five is enough headroom for a
 * tracking/shortener/CDN chain without letting a misbehaving server bounce forever. */
export const MAX_WEB_FETCH_REDIRECTS = 5;
/** Identifies the tool to whoever's server it hits, since it sends no other identifying
 * information (no cookies, no auth) - see url-policy.ts for what it refuses to reach. */
export const WEB_FETCH_USER_AGENT = 'CodeYantram/0.1 (+https://github.com/harshalslimaye/codeyantram)';

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

/** Sniffs the first few KB for null bytes or a high ratio of non-printable bytes, the same heuristic `file(1)` and most editors use. */
export function isBinary(sample: Buffer): boolean {
    if (sample.length === 0) return false;

    let nonPrintable = 0;
    for (const byte of sample) {
        if (byte === 0) return true;
        if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++;
    }

    return nonPrintable / sample.length > 0.3;
}

export type WriteTarget = {
    target: string;
    /** Parent directories that don't exist yet and would be created by this write. */
    missingDirs: number;
    /** The target path is itself an existing symlink (one that stays inside the project). */
    viaSymlink: boolean;
};

/** Containment check for a path being *written*, where resolveRealInProject can't help: a file
 * being created doesn't exist yet, so realpath fails on it and the symlink check silently passes.
 * This resolves the deepest ancestor that does exist, checks that against the real root, and
 * separately resolves the target itself when it's already a symlink - so neither `link -> /etc`
 * + `link/passwd` nor a pre-planted `config.json -> /etc/passwd` can write outside the project.
 * Also reports how much of the path is missing, since mkdir -p will otherwise create any depth
 * of directory chain a malformed path asks for. */
export async function resolveRealForWrite(cwd: string, relativePath: string): Promise<WriteTarget> {
    const root = resolve(cwd);
    const target = resolveInProject(cwd, relativePath);
    const realRoot = await realpath(root);

    const segments = relative(root, target).split(sep).filter(Boolean);
    if (segments.length > MAX_PATH_SEGMENTS) {
        throw new Error(`"${relativePath}" is ${segments.length} levels deep, over the ${MAX_PATH_SEGMENTS}-level path limit`);
    }

    const assertContained = (real: string, through: string): void => {
        if (real !== realRoot && !real.startsWith(realRoot + sep)) {
            throw new Error(`"${relativePath}" resolves outside the project root through ${through}`);
        }
    };

    // Walk up until something exists - everything skipped on the way is a directory this
    // write would have to create.
    let missingDirs = 0;
    for (let ancestor = dirname(target); ; ancestor = dirname(ancestor)) {
        const real = await realpath(ancestor).catch(() => null);
        if (real !== null) {
            assertContained(real, 'a symlinked parent directory');
            break;
        }

        missingDirs++;
        // The root itself always exists, so this only guards against an unterminated walk.
        if (dirname(ancestor) === ancestor) break;
    }

    if (missingDirs > MAX_NEW_DIR_DEPTH) {
        throw new Error(`"${relativePath}" would create ${missingDirs} new directories, over the ${MAX_NEW_DIR_DEPTH}-directory limit - check the path for a typo`);
    }

    const link = await lstat(target).catch(() => null);
    if (link === null || !link.isSymbolicLink()) return { target, missingDirs, viaSymlink: false };

    // A dangling symlink has no realpath, but writing through it still creates its target -
    // so resolve what it points at by hand rather than treating it as a plain new file.
    const real = (await realpath(target).catch(() => null)) ?? resolve(dirname(target), await readlink(target));
    assertContained(real, 'a symlink');

    return { target, missingDirs, viaSymlink: true };
}

// WHATWG label for Latin-1: the standard folds latin1/iso-8859-1 onto the windows-1252
// decoder, which is the one that actually maps 0x80-0x9F to printable characters.
export type TextEncodingLabel = 'utf-8' | 'windows-1252';

/** Drops a multi-byte UTF-8 sequence left incomplete by the sample's cut-off point -
 * those trailing bytes are only half a character, and validating them would report a
 * perfectly good UTF-8 file as some other encoding. */
export function trimIncompleteUtf8Tail(sample: Buffer): Buffer {
    for (let i = sample.length - 1, available = 1; i >= 0 && available <= 4; i--, available++) {
        const byte = sample[i]!;
        if ((byte & 0b1100_0000) === 0b1000_0000) continue; // continuation byte - keep walking back to the lead byte

        const expected =
            byte < 0x80 ? 1 : (byte & 0b1110_0000) === 0b1100_0000 ? 2 : (byte & 0b1111_0000) === 0b1110_0000 ? 3 : (byte & 0b1111_1000) === 0b1111_0000 ? 4 : 1;

        return expected > available ? sample.subarray(0, i) : sample;
    }

    return sample;
}

/** Decoding a Latin-1 response/file as UTF-8 silently fills it with replacement characters,
 * so the encoding is decided up front from the same sample a binary sniff would use: valid
 * UTF-8 wins, anything else falls back to latin1. Only the sample is checked - content whose
 * first 8 KB is clean UTF-8 but turns invalid later is rare enough to not be worth scanning
 * the whole thing for. */
export function pickEncoding(sample: Buffer, sampleIsPartial: boolean): TextEncodingLabel {
    const candidate = sampleIsPartial ? trimIncompleteUtf8Tail(sample) : sample;

    try {
        new TextDecoder('utf-8', { fatal: true }).decode(candidate);
        return 'utf-8';
    } catch {
        return 'windows-1252';
    }
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
