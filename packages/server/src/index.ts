import { Hono } from 'hono';

export const app = new Hono();

app.get('/health', c => c.json({ status: 'ok' }));

app.get('/', c => c.json({ message: 'Welcome to the server' }));

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

export default {
    fetch: app.fetch,
    port,
};
