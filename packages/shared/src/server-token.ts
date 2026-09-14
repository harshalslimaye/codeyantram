import { isRealIoEnabled, readJsonFile, writeJsonFile } from './local-store';

const SERVER_TOKEN_FILE = 'server-token.json';

type ServerTokenStore = { token: string };

export function readServerToken(): string | undefined {
    return readJsonFile<ServerTokenStore>(SERVER_TOKEN_FILE)?.token;
}

function writeServerToken(token: string): void {
    writeJsonFile(SERVER_TOKEN_FILE, { token }, { mode: 0o600 });
}

/**
 * Returns the server's local auth token, minting and persisting a new one on first call
 * if none exists yet. The server is the only side that ever mints one - the CLI only
 * ever reads via readServerToken(), since generating a credential is the enforcing
 * side's job, not the client's.
 *
 * Read fresh (via readJsonFile, not cached in a module-level variable) on every call
 * rather than resolved once: the cost is one small JSON read, negligible next to a
 * human-paced chat request, and it buys two things a cached value couldn't. A manually
 * regenerated token file takes effect on the very next request instead of needing a
 * server restart. And, just as importantly for testing this at all: the server's `app`
 * (server/src/index.ts) is a module-level singleton constructed once at import time - if
 * the token were captured into a closure then, a test that sets CODEYANTRAM_CONFIG_DIR
 * in its own setup would always be too late, racing against whatever value got baked in
 * when the test runner first imported the module.
 */
export function getOrCreateServerToken(): string {
    const existing = readServerToken();
    if (existing !== undefined) return existing;

    const token = crypto.randomUUID();
    writeServerToken(token);
    return token;
}

/**
 * Whether the server should actually require getOrCreateServerToken()'s value on
 * incoming requests. Enforcement is skipped precisely when isRealIoEnabled() would also
 * skip real persistence - bun test's own NODE_ENV=test, with no CODEYANTRAM_CONFIG_DIR
 * override. That case matters specifically here: with persistence disabled,
 * getOrCreateServerToken() mints a fresh, unobservable random value on every single call
 * (nothing was actually written for a later call to read back), so no request could ever
 * supply the value the next comparison expects - blanket enforcement would 401 every one
 * of the server's own pre-existing route tests, none of which have anything to do with
 * auth, by construction rather than by anything they got wrong.
 *
 * This mirrors, rather than works around, the same test-environment carve-out
 * local-store.ts already applies everywhere else in this codebase: production
 * enforcement is untouched (isRealIoEnabled() is only ever false under `bun test`), and a
 * test that specifically wants to exercise real enforcement can still do so by setting
 * CODEYANTRAM_CONFIG_DIR - the same escape hatch every other real-I/O test here already
 * uses (see server-auth.test.ts).
 */
export function isServerTokenEnforced(): boolean {
    return isRealIoEnabled();
}
