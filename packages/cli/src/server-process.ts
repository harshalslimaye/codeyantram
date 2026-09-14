import { spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR_MODE, configDir, ensureDir } from '@codeyantram/shared';

// Points at the server's source entry, not a package import - @codeyantram/server stays
// a devDependency-only relationship for the CLI (see api/client.ts's own comment on
// AppType), so this spawns it as a separate OS process by file path instead of pulling
// its code into the CLI's own module graph. Resolved from this module's own location
// rather than the process cwd, same reasoning as the server's runtime/env.ts.
//
// This path is monorepo-shaped (packages/cli/../server/src/index.ts) and only resolves
// under a checkout of this repo - a real npm/bun install of the published CLI has no
// sibling packages/server directory to find. Phase 5 (packaging) replaces this with a
// lookup against the CLI's own installed dependency tree once the server ships as a
// proper package with a built, Node-resolvable entry point; until then, this only works
// against a monorepo checkout, exactly like `bun run dev:server` already only did.
const SERVER_ENTRY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../server/src/index.ts');

const STARTUP_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 150;
const REACHABILITY_TIMEOUT_MS = 500;

export interface ManagedServer {
    /** Stops the server this process spawned. Never call this for a server this
     * process didn't start - see ensureServerRunning's `null` return. */
    stop(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

/** A server (this one's, or anyone else's) is "reachable" the moment *any* HTTP response
 * comes back from `${baseUrl}/health` - even the 401 an unauthenticated request gets
 * (see server/src/index.ts's requireServerToken() on '*'). Reachability just answers "is
 * something listening and speaking HTTP here", not "am I authorized" - the same
 * local-only trust model the server's own header check already relies on. */
async function isServerReachable(baseUrl: string, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        await fetch(`${baseUrl}/health`, { signal: controller.signal });
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

/** Starts the local server if nothing is answering at `baseUrl` yet, and waits until it
 * is. Returns `null` when a server was already reachable - a manually-run
 * `bun run dev:server`, or another CLI instance sharing this config dir - so the caller
 * never spawns a second one and never tears down a process it didn't start.
 *
 * Runtime-agnostic by construction: spawns via node:child_process (not Bun.spawn) and
 * re-executes the *current* runtime (process.execPath - whichever of `bun`/`node`
 * launched this CLI process) against the server's entry file, so a Bun-run CLI gets a
 * Bun-run server and a Node-run CLI gets a Node-run server, without this module needing
 * to know or care which one it is. */
export async function ensureServerRunning(baseUrl: string): Promise<ManagedServer | null> {
    if (await isServerReachable(baseUrl, REACHABILITY_TIMEOUT_MS)) {
        return null;
    }

    ensureDir(configDir(), CONFIG_DIR_MODE);
    // The server's own console.log/console.error (prune-sweep summaries, shutdown
    // errors) would otherwise interleave with the TUI's own screen writes and corrupt
    // the display - redirected to a file instead, same directory as this CLI's other
    // local state (auth.json, sessions.db).
    const logFd = openSync(join(configDir(), 'server.log'), 'a');

    // PORT must match whatever port `baseUrl` actually names - the server itself only
    // ever reads process.env.PORT (defaulting to 3001; see index.ts), with no way to
    // pass it a port directly, so a caller of ensureServerRunning() with a non-default
    // baseUrl (tests, or a future --port flag) would otherwise spawn a server on the
    // wrong port and then poll a different one forever.
    const port = new URL(baseUrl).port;
    const child = spawn(process.execPath, [SERVER_ENTRY_PATH], {
        stdio: ['ignore', logFd, logFd],
        env: port === '' ? process.env : { ...process.env, PORT: port },
    });

    // Without this, the mere existence of a live child handle keeps this CLI process's
    // event loop from ever draining on its own - the UI's own quit paths (input-bar.tsx,
    // command-menu.tsx) call renderer.destroy() and nothing else, exactly as they did
    // before this module existed, and none of them needed touching for that to still be
    // enough to actually exit.
    child.unref();

    // The synchronous fallback for the exact case unref() creates: this CLI process is
    // about to exit (drained naturally, or via an explicit process.exit() elsewhere)
    // while the server it spawned is still running. A process's 'exit' listeners must be
    // synchronous - this can only signal the child, not await its shutdown - but that's
    // fine: the server's own SIGTERM handler (index.ts) closes the DB and its listener
    // without needing this process to still be around to see it happen.
    process.once('exit', () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    });

    // A spawn failure (e.g. ENOENT if SERVER_ENTRY_PATH doesn't exist - see its own
    // comment) surfaces as an 'error' event, not a thrown exception - captured here so
    // the readiness poll below fails fast with a clear cause instead of just timing out.
    let spawnError: Error | undefined;
    child.once('error', error => {
        spawnError = error;
    });

    try {
        const deadline = Date.now() + STARTUP_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (spawnError) throw spawnError;
            if (await isServerReachable(baseUrl, REACHABILITY_TIMEOUT_MS)) {
                return { stop: () => stopChild(child) };
            }
            await sleep(POLL_INTERVAL_MS);
        }
        throw new Error(`codeyantram server did not become reachable within ${STARTUP_TIMEOUT_MS}ms`);
    } catch (error) {
        await stopChild(child);
        throw error;
    }
}

function stopChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

    return new Promise<void>(resolvePromise => {
        child.once('exit', () => resolvePromise());
        // SIGTERM, not SIGKILL - the server's own shutdown handler (index.ts) closes
        // the session store and its HTTP listener on this signal; skipping straight to
        // SIGKILL would leave sessions.db's WAL file unmerged (harmless, per closeDb's
        // own comment, but there's no reason to force that path on every CLI exit).
        child.kill('SIGTERM');
    });
}
