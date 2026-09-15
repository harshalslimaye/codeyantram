import { Hono } from 'hono';
import { getOpenRouterModels } from '../lib/openrouter-models';

// The static catalog's four providers are already known to the CLI at build time (see
// modelsResponseSchema's own comment in @codeyantram/shared) - this only ever needs to
// carry what the CLI can't otherwise know: OpenRouter's live-fetched catalog.
const app = new Hono().get('/', async c => {
    try {
        const models = await getOpenRouterModels();
        return c.json({ models });
    } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch models' }, 502);
    }
});

export default app;
