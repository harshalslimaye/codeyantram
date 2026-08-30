import { Hono } from 'hono';
import { API_ROUTES } from '@codeyantram/shared';
import chatRouter from './routers/chat';
import providersRouter from './routers/providers';

export const app = new Hono();

app.get('/health', c => c.json({ status: 'ok' }));

app.get('/', c => c.json({ message: 'Welcome to the server' }));

app.route(API_ROUTES.chat, chatRouter);
app.route(API_ROUTES.providers, providersRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

export default {
    fetch: app.fetch,
    port,
};
