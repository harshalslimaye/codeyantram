import { Hono } from 'hono';
import { API_ROUTES, getOrCreateServerToken, isTestEnv } from '@codeyantram/shared';
import { closeDb, getSessionStore } from '@codeyantram/sessions';
import chatRouter from './routers/chat';
import providersRouter from './routers/providers';
import sessionsRouter from './routers/sessions';
import { requireServerToken } from './lib/server-auth';
import { serveApp, type RuntimeServerHandle } from './runtime/http';

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

// Retention: sessions.db has no size cap of its own (see @codeyantram/sessions'
// pruneSessions), so left alone it grows forever - every session, from every project this
// server has ever seen, kept in full. These two caps are independent triggers ("keep the
// newest N ... AND drop anything older than D days"), not a combined threshold - see
// pruneSessions' own PruneOptions doc. Numbers chosen generously: a personal local store,
// not a hard resource limit, so this should almost never delete anything a user would
// actually have gone looking for.
export const KEEP_NEWEST_SESSIONS_PER_PROJECT = 200;
export const MAX_SESSION_AGE_DAYS = 90;

// Runs once, at process start, not on a timer - a long-lived server sees this at most
// once per restart, and a personal local store doesn't need continuous pruning while
// it's running. pruneSessions is scoped to one project at a time (it has no idea what
// "all of them" means), so this fans out over listProjects() first - the server itself
// tracks no notion of "the current project"; it only ever sees whatever `cwd` each
// request happens to carry, across however many different projects have used it.
//
// Fire-and-forget: awaited for its own sake (so a failure surfaces in the log, not as an
// unhandled rejection) but never blocks startup - the server should start accepting chat
// requests immediately, independent of how long a prune sweep over however many projects
// takes, or whether it fails at all. A failure here is logged, not thrown - it must never
// stop the server itself from starting.
// Exported for prune-on-start.test.ts, which calls this directly against its own temp
// CODEYANTRAM_CONFIG_DIR rather than relying on the module-scope call below (guarded off
// under isTestEnv(), same as the shutdown handler - see its own comment for why).
export async function pruneOldSessions(): Promise<void> {
    try {
        const store = await getSessionStore();
        const projects = await store.listProjects();

        let totalDeleted = 0;
        for (const project of projects) {
            totalDeleted += await store.pruneSessions({
                project,
                keepNewest: KEEP_NEWEST_SESSIONS_PER_PROJECT,
                olderThanDays: MAX_SESSION_AGE_DAYS,
            });
        }

        // VACUUM is worth its own file-rewrite cost only once something was actually
        // deleted - see the store's own comment on why this isn't folded into
        // pruneSessions itself.
        if (totalDeleted > 0) {
            console.log(`[sessions] pruned ${totalDeleted} old session(s) across ${projects.length} project(s)`);
            await store.vacuum();
        }
    } catch (error) {
        console.error('[sessions] startup prune failed:', error);
    }
}

// Gated the same way the shutdown handler below is (see its own comment) - a `bun test`
// import of this module must never open a real database or start background work no
// test asked for.
if (!isTestEnv()) {
    void pruneOldSessions();
}

const serverHandlePromise: Promise<RuntimeServerHandle> | null = isTestEnv()
    ? null
    : serveApp(app.fetch, { port, hostname: '127.0.0.1' });

if (!isTestEnv()) {
    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        void Promise.all([closeDb(), serverHandlePromise?.then(handle => handle.close())]).finally(() =>
            process.exit(0),
        );
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}
