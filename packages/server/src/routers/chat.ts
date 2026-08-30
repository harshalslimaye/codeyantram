import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { chatRequestSchema } from '@codeyantram/shared';
import { streamChatResponse } from '../lib/chat-stream';

const app = new Hono().post(
    '/',
    zValidator('json', chatRequestSchema, (result, c) => {
        if (!result.success) return c.json({ error: result.error.issues }, 400);
    }),
    async c => {
        const request = c.req.valid('json');
        const abortController = new AbortController();

        return streamSSE(
            c,
            async stream => {
                stream.onAbort(() => abortController.abort());
                await streamChatResponse(stream, { request, abortController });
            },
            async (err, stream) => {
                // Safety net for anything that escaped streamChatResponse's own try/catch.
                await stream.writeSSE({
                    data: JSON.stringify({ type: 'error', code: 'internal_error', message: err.message }),
                });
            },
        );
    },
);

export default app;
