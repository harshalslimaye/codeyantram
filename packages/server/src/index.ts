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

export default {
    fetch: app.fetch,
    port,
};
