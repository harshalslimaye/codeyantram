import { Hono } from 'hono';
import { API_ROUTES, getOrCreateServerToken, isTestEnv } from '@codeyantram/shared';
import { closeDb } from '@codeyantram/sessions';
import chatRouter from './routers/chat';
import providersRouter from './routers/providers';
import sessionsRouter from './routers/sessions';
import { requireServerToken } from './lib/server-auth';

// Chained into one expression (rather than separate `app.get(...)`
// statements) so `typeof app` actually carries every route's type - Hono's
// RPC client (hc<AppType>()) can only see routes registered this way.
//
// requireServerToken() is first in the chain so it gates every route below it,
// /health included - there's no route here sensitive enough to need an
// exception, and a uniform gate is one fewer thing to get wrong later by
// forgetting to add a new route to an exceptions list.
export const app = new Hono()
    .use('*', requireServerToken())
    .get('/health', c => c.json({ status: 'ok' }))
    .route(API_ROUTES.chat, chatRouter)
    .route(API_ROUTES.providers, providersRouter)
    .route(API_ROUTES.sessions, sessionsRouter);

export type AppType = typeof app;

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

// Ensures the token file exists as soon as the process starts, not only once the first
// request arrives - the return value isn't needed here (requireServerToken() re-reads it
// per request; see server-token.ts for why), this call is purely the "on first start"
// side effect. A no-op under `bun test` with no CODEYANTRAM_CONFIG_DIR override, same as
// every other real-I/O call in this codebase.
getOrCreateServerToken();

// The sessions database is opened lazily (see @codeyantram/sessions' getDb()) the first
// time a /sessions request actually needs it - nothing to do here for that half of "own
// the connection lifecycle". This is the other half: closing it cleanly on shutdown.
//
// Not a correctness requirement - SQLite's WAL mode already recovers cleanly from an
// ungraceful kill - but closing runs a passive checkpoint, folding the WAL file back
// into sessions.db itself, so the one file stays a complete snapshot rather than relying
// on its -wal/-shm sidecars always traveling with it (see closeDb()'s own comment).
//
// Gated on isTestEnv(), not isRealIoEnabled() - several of this package's own tests
// deliberately turn real I/O on via CODEYANTRAM_CONFIG_DIR for unrelated reasons (a real
// session store to test against), and none of them want a live shutdown handler for
// that. Every test file that imports `app` re-evaluates this module's top level once, so
// without this guard a `bun test` run would both register this many times over (a
// MaxListenersExceededWarning waiting to happen) and let a stray Ctrl+C during the test
// run exit the process before Bun's own test runner gets to report results.
if (!isTestEnv()) {
    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        void closeDb().finally(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

export default {
    fetch: app.fetch,
    port,
    // Bun's default hostname is 0.0.0.0 - every interface, not just this machine. Without
    // this, the server (and every provider API key it holds) is reachable from anyone on
    // the same network, not just local processes; the token above only defends against
    // the latter.
    hostname: '127.0.0.1',
};
