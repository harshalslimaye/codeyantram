import { Hono } from 'hono';
import { API_ROUTES } from '@codeyantram/shared';
import chatRouter from './routers/chat';
import providersRouter from './routers/providers';

// Chained into one expression (rather than separate `app.get(...)`
// statements) so `typeof app` actually carries every route's type - Hono's
// RPC client (hc<AppType>()) can only see routes registered this way.
export const app = new Hono()
    .get('/health', c => c.json({ status: 'ok' }))
    .route(API_ROUTES.chat, chatRouter)
    .route(API_ROUTES.providers, providersRouter);

export type AppType = typeof app;

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

// Bun.serve defaults to 0.0.0.0 when no hostname is given, which would put
// this "small local server" (see README) - unauthenticated, and trusting
// whatever `cwd` a request claims as the project root - on the network. Pin
// it to loopback so only processes on this machine can ever reach it.
const hostname = process.env.HOST ?? '127.0.0.1';

export default {
    fetch: app.fetch,
    port,
    hostname,
};
