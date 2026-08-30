import { streamText, type ModelMessage } from 'ai';
import type { SSEStreamingApi } from 'hono/streaming';
import {
    PROVIDER_ENV_VARS,
    type ChatRequest,
    type ChatStreamEvent,
    type RequestMessage,
    type ToolCallPart,
} from '@codeyantram/shared';
import { MissingCredentialsError, resolveChatModel } from './models';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Converts one assistant message's tool-call parts into a tool-call content block plus, for any that already resolved, the matching tool-result message. */
function toolPartsToMessages(parts: ToolCallPart[]): ModelMessage[] {
    const messages: ModelMessage[] = [
        {
            role: 'assistant',
            content: parts.map(part => ({
                type: 'tool-call' as const,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.args,
            })),
        },
    ];

    const resolved = parts.filter(part => part.result !== undefined);
    if (resolved.length > 0) {
        messages.push({
            role: 'tool',
            content: resolved.map(part => ({
                type: 'tool-result' as const,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: { type: 'text' as const, value: part.result as string },
            })),
        });
    }

    return messages;
}

/** No tool loop exists yet on either side, so in practice every message is text-only; the tool-call branch is here so the schema's tool-call parts round-trip correctly once one does. */
export function toModelMessages(messages: RequestMessage[]): ModelMessage[] {
    return messages.flatMap((message): ModelMessage[] => {
        if (message.role === 'user') {
            return [{ role: 'user', content: message.parts.map(part => part.text).join('') }];
        }

        const textParts = message.parts.filter(part => part.type === 'text');
        const toolCallParts = message.parts.filter(part => part.type === 'tool-call');

        const result: ModelMessage[] = [];
        if (textParts.length > 0 || toolCallParts.length === 0) {
            result.push({ role: 'assistant', content: textParts.map(part => part.text).join('') });
        }
        if (toolCallParts.length > 0) {
            result.push(...toolPartsToMessages(toolCallParts));
        }
        return result;
    });
}

async function send(stream: SSEStreamingApi, event: ChatStreamEvent): Promise<void> {
    await stream.writeSSE({ data: JSON.stringify(event) });
}

/**
 * Streams one chat turn as SSE. A stream always opens with "start"; per
 * chatStreamEventSchema, everything after - including a request-time failure
 * like a missing key - is reported as an "error" event on that same stream
 * rather than an HTTP error status, so the CLI has exactly one path (parse
 * SSE events) for both success and failure. An aborted request (the caller's
 * AbortController firing) closes the connection with neither "done" nor
 * "error" - the schema treats that as a normal outcome, not a failure.
 */
export async function streamChatResponse(
    stream: SSEStreamingApi,
    { request, abortController }: { request: ChatRequest; abortController: AbortController },
): Promise<void> {
    const messageId = crypto.randomUUID();
    await send(stream, { type: 'start', messageId });

    let resolved;
    try {
        resolved = resolveChatModel(request.model, request.effort);
    } catch (error) {
        if (error instanceof MissingCredentialsError) {
            await send(stream, {
                type: 'error',
                code: 'missing_credentials',
                message: `No API key for ${error.provider}. Set ${PROVIDER_ENV_VARS[error.provider]} or run /connect.`,
            });
            return;
        }
        throw error;
    }

    const { languageModel, providerOptions } = resolved;
    const startedAt = Date.now();

    try {
        const result = streamText({
            model: languageModel,
            messages: toModelMessages(request.messages),
            providerOptions,
            abortSignal: abortController.signal,
        });

        for await (const part of result.stream) {
            if (stream.aborted) return;

            switch (part.type) {
                case 'text-delta':
                    await send(stream, { type: 'text-delta', text: part.text });
                    break;
                case 'reasoning-delta':
                    await send(stream, { type: 'reasoning-delta', text: part.text });
                    break;
                case 'tool-call':
                    await send(stream, {
                        type: 'tool-call',
                        toolCallId: part.toolCallId,
                        toolName: part.toolName,
                        // Round-tripped through JSON so an arbitrary tool-call input
                        // always satisfies the schema's z.json() args type.
                        args: JSON.parse(JSON.stringify(isRecord(part.input) ? part.input : {})),
                    });
                    break;
                case 'tool-result':
                    await send(stream, {
                        type: 'tool-result',
                        toolCallId: part.toolCallId,
                        result: typeof part.output === 'string' ? part.output : JSON.stringify(part.output),
                    });
                    break;
                case 'abort':
                    return;
                case 'error':
                    await send(stream, {
                        type: 'error',
                        code: 'provider_error',
                        message: part.error instanceof Error ? part.error.message : String(part.error),
                    });
                    return;
                default:
                    break;
            }
        }

        if (abortController.signal.aborted) return;

        await send(stream, { type: 'done', durationMs: Date.now() - startedAt });
    } catch (error) {
        if (abortController.signal.aborted) return;

        await send(stream, {
            type: 'error',
            code: 'provider_error',
            message: error instanceof Error ? error.message : 'Unknown provider error',
        });
    }
}
