import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
    appendMessageRequestSchema,
    createSessionRequestSchema,
    listSessionsQuerySchema,
    renameSessionRequestSchema,
    resolveApprovalRequestSchema,
} from '@codeyantram/shared';
import { getSessionStore, InvalidTitleError, SessionNotFoundError, ToolCallNotFoundError } from '@codeyantram/sessions';

/**
 * Translates the store's own typed errors into the HTTP response the router promised
 * (see the wire schemas in shared/src/schemas.ts) - the one piece of "business logic"
 * this file has, and it is entirely about mapping, not deciding: every actual decision
 * (does this title count as empty, does this tool call exist) already happened inside
 * @codeyantram/sessions. Anything not one of these three known types is re-thrown and
 * left to Hono's own default error handling, the same as an unexpected failure anywhere
 * else in this app.
 */
function errorResponse(c: Context, error: unknown): Response {
    if (error instanceof SessionNotFoundError) return c.json({ error: error.message }, 404);
    if (error instanceof ToolCallNotFoundError) return c.json({ error: error.message }, 404);
    if (error instanceof InvalidTitleError) return c.json({ error: error.message }, 400);
    throw error;
}

// Chained into one expression, like chatRouter and providersRouter - this sub-router is
// mounted into the top-level app via .route(API_ROUTES.sessions, ...), and the RPC
// client (hc<AppType>()) can only see a nested route's typed methods if every route
// under it, here included, is built as a single chain rather than separate statements.
const app = new Hono()
    .get(
        '/',
        zValidator('query', listSessionsQuerySchema, (result, c) => {
            if (!result.success) return c.json({ error: result.error.issues }, 400);
        }),
        async c => {
            const { project } = c.req.valid('query');
            const store = await getSessionStore();
            const sessions = await store.listSessions(project);
            return c.json({ sessions });
        },
    )
    .post(
        '/',
        zValidator('json', createSessionRequestSchema, (result, c) => {
            if (!result.success) return c.json({ error: result.error.issues }, 400);
        }),
        async c => {
            const request = c.req.valid('json');
            const store = await getSessionStore();
            const { id, title } = await store.createSession({
                project: request.cwd,
                modelId: request.model,
                agentName: request.agent,
                effort: request.effort ?? null,
                firstMessage: request.firstMessage,
            });
            return c.json({ id, title }, 201);
        },
    )
    .get('/:id', async c => {
        const id = c.req.param('id');
        const store = await getSessionStore();
        const session = await store.loadSession(id);
        if (session === null) return c.json({ error: `No session found with id ${id}` }, 404);
        return c.json({ session });
    })
    .post(
        '/:id/messages',
        zValidator('json', appendMessageRequestSchema, (result, c) => {
            if (!result.success) return c.json({ error: result.error.issues }, 400);
        }),
        async c => {
            const id = c.req.param('id');
            const { message } = c.req.valid('json');
            const store = await getSessionStore();
            try {
                await store.appendMessage(id, message);
            } catch (error) {
                return errorResponse(c, error);
            }
            return c.json({ ok: true as const });
        },
    )
    .post(
        '/:id/approvals',
        zValidator('json', resolveApprovalRequestSchema, (result, c) => {
            if (!result.success) return c.json({ error: result.error.issues }, 400);
        }),
        async c => {
            const id = c.req.param('id');
            const { toolCallId, approved } = c.req.valid('json');
            const store = await getSessionStore();
            try {
                await store.resolveApproval(id, toolCallId, approved);
            } catch (error) {
                return errorResponse(c, error);
            }
            return c.json({ ok: true as const });
        },
    )
    .patch(
        '/:id',
        zValidator('json', renameSessionRequestSchema, (result, c) => {
            if (!result.success) return c.json({ error: result.error.issues }, 400);
        }),
        async c => {
            const id = c.req.param('id');
            const { title } = c.req.valid('json');
            const store = await getSessionStore();
            try {
                await store.renameSession(id, title);
            } catch (error) {
                return errorResponse(c, error);
            }
            return c.json({ ok: true as const });
        },
    )
    .delete('/:id', async c => {
        const id = c.req.param('id');
        const store = await getSessionStore();
        try {
            await store.deleteSession(id);
        } catch (error) {
            return errorResponse(c, error);
        }
        return c.json({ ok: true as const });
    });

export default app;
