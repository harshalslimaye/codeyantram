import { Hono } from 'hono';
import { getUsableProviders } from '../providers';

const app = new Hono().get('/', c => c.json({ configuredProviders: getUsableProviders() }));

export default app;
