import { stepCountIs, streamText, type ModelMessage } from 'ai';
import type { SSEStreamingApi } from 'hono/streaming';
import {
    PROVIDER_ENV_VARS,
    agentBypassesApproval,
    agentHasFullToolAccess,
    agentHasTools,
    type ChatRequest,
    type ChatStreamEvent,
    type RequestMessage,
    type ToolCallPart,
} from '@codeyantram/shared';
import { MissingCredentialsError, UnknownModelError, resolveChatModel } from './models';
import { loadPromptInstructions, type PromptInstructions } from './project-instructions';
import { rollConversationCache, supportsCacheControl, withConversationCache } from './prompt-cache';
import { getSystemMessages } from './system-prompt';
import { buildProjectTools, createTurnToolAccounting, toSubagentUsage, toToolUsage } from '../tools';

// Caps how many tool-call/response round trips streamText will run within
// one turn before giving up and returning whatever it has - a guard against
// a confused model looping on a tool indefinitely.
const MAX_TOOL_STEPS = 15;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Above this, a string argument is replayed as a length note instead of its literal value.
// Denied calls never ran, so the file/edit content they carried bought nothing - but it is
// still replayed byte-for-byte on every later step and turn of the session (see
// prompt-cache.ts's own comment on the same cost for approved tool results). A short string
// (a path, a command, a pattern) is exactly the thing toolArgsSummary in the CLI's
// message-list.tsx already renders and is worth keeping so the transcript still reads
// sensibly; the pattern this exists for is write_file's `content` or edit_file's
// `old_string`/`new_string`, which can run to thousands of characters for a single denial.
const MAX_DENIED_ARG_STRING_LENGTH = 200;

/** Recursively replaces long string values with a length note, leaving short strings,
 * numbers, booleans, and structure (array/object shape) untouched. Only ever called on a
 * denied call's args (see toolPartsToMessages) - an approved or still-pending call's args
 * are left exactly as the model sent them. */
function redactDeniedArgs(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.length > MAX_DENIED_ARG_STRING_LENGTH
            ? `[denied - ${value.length} chars omitted]`
            : value;
    }
    if (Array.isArray(value)) return value.map(redactDeniedArgs);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactDeniedArgs(entry)]));
    }
    return value;
}

/**
 * Converts one assistant message's tool-call parts into a tool-call content
 * block - plus, for any part that went through approval, the matching
 * "tool-approval-request" content (AI SDK requires both to be replayed
 * together) - and a paired tool message carrying whichever of the approval
 * response / tool-result are already resolved.
 */
function toolPartsToMessages(parts: ToolCallPart[]): ModelMessage[] {
    const messages: ModelMessage[] = [
        {
            role: 'assistant',
            content: parts.flatMap(part => {
                const toolCall = {
                    type: 'tool-call' as const,
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    input: part.approvalStatus === 'denied' ? redactDeniedArgs(part.args) : part.args,
                };

                return part.approvalId === undefined
                    ? [toolCall]
                    : [
                          toolCall,
                          {
                              type: 'tool-approval-request' as const,
                              approvalId: part.approvalId,
                              toolCallId: part.toolCallId,
                          },
                      ];
            }),
        },
    ];

    const toolContent = parts.flatMap(part => {
        const entries = [];

        if (part.approvalStatus === 'approved' || part.approvalStatus === 'denied') {
            entries.push({
                type: 'tool-approval-response' as const,
                approvalId: part.approvalId as string,
                approved: part.approvalStatus === 'approved',
            });
        }

        if (part.result !== undefined) {
            entries.push({
                type: 'tool-result' as const,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: { type: 'text' as const, value: part.result },
            });
        }

        return entries;
    });

    if (toolContent.length > 0) {
        messages.push({ role: 'tool', content: toolContent });
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

    // Off-switch (see /instructions in the CLI) controls every instruction source
    // uniformly - global, project root, and nested (read_file's own attachment below) -
    // one on/off idea rather than a per-source toggle the user would have to reason about.
    const includeInstructions = request.useProjectInstructions !== false;

    // Re-read per turn rather than once per session, so an edit to either instruction
    // file - by the user or by the Build agent itself - applies to the very next message.
    // Loaded before "start" (and before model resolution) so the project file's metadata
    // rides on that event even when the turn fails before ever reaching streamText - the
    // CLI's off-switch and truncation warning need it regardless of how the turn ends.
    const instructions: PromptInstructions = includeInstructions
        ? await loadPromptInstructions(request.cwd)
        : { global: null, project: null };

    await send(stream, {
        type: 'start',
        messageId,
        projectInstructions: instructions.project
            ? { filename: instructions.project.filename, bytes: instructions.project.bytes, truncated: instructions.project.truncated }
            : undefined,
    });

    let resolved;
    try {
        resolved = await resolveChatModel(request.model, request.effort);
    } catch (error) {
        if (error instanceof MissingCredentialsError) {
            await send(stream, {
                type: 'error',
                code: 'missing_credentials',
                message: `No API key for ${error.provider}. Set ${PROVIDER_ENV_VARS[error.provider]} or run /connect.`,
            });
            return;
        }
        // Reachable for real now that model ids aren't fully validated until here (see
        // chatModelIdSchema's own comment in @codeyantram/shared) - a stale OpenRouter id
        // the picker offered before its next refetch, or one typed by hand.
        if (error instanceof UnknownModelError) {
            await send(stream, {
                type: 'error',
                code: 'invalid_request',
                message: `${error.message}. It may no longer be offered by its provider.`,
            });
            return;
        }
        throw error;
    }

    const { model, languageModel, providerOptions } = resolved;
    const startedAt = Date.now();

    const toolsEnabled = agentHasTools(request.agent);
    // One per turn, closed over by this turn's executors and read once at "done" - see
    // TurnToolAccounting. Created even when tools are off so the read below needs no
    // branch; it simply stays empty.
    const accounting = createTurnToolAccounting();

    try {
        const result = streamText({
            model: languageModel,
            system: getSystemMessages(request.agent, instructions, supportsCacheControl(model.provider)),
            messages: withConversationCache(toModelMessages(request.messages), model.provider),
            // Re-anchors the conversation breakpoints between tool steps, so a long turn's
            // own output is cached as it accrues instead of being re-sent at full price on
            // every step (see rollConversationCache).
            prepareStep: ({ messages }) => rollConversationCache(messages, model.provider),
            providerOptions,
            abortSignal: abortController.signal,
            tools: toolsEnabled
                ? buildProjectTools({
                      cwd: request.cwd,
                      restricted: !agentHasFullToolAccess(request.agent),
                      includeProjectInstructions: includeInstructions,
                      skipApproval: agentBypassesApproval(request.agent),
                      accounting,
                      workerModel: {
                          requested: request.workerModel,
                          effort: request.workerEffort,
                          orchestratorModelId: model.id,
                      },
                  })
                : undefined,
            stopWhen: toolsEnabled ? stepCountIs(MAX_TOOL_STEPS) : undefined,
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
                case 'tool-approval-request':
                    await send(stream, {
                        type: 'tool-approval-request',
                        toolCallId: part.toolCall.toolCallId,
                        approvalId: part.approvalId,
                    });
                    break;
                // Reported through the same "tool-result" event the CLI already
                // renders as the call's terminal state - a denial or an error
                // the AI SDK itself raised (execute()'s own errors are already
                // caught and returned as a string result, never as "tool-error").
                case 'tool-output-denied':
                    await send(stream, {
                        type: 'tool-result',
                        toolCallId: part.toolCallId,
                        result: 'Denied by user.',
                    });
                    break;
                case 'tool-error':
                    await send(stream, {
                        type: 'tool-result',
                        toolCallId: part.toolCallId,
                        result: `Error: ${part.error instanceof Error ? part.error.message : String(part.error)}`,
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

        const usage = await result.usage;
        // Which tool filled the window, which `usage` below can't say - it reports how big
        // the prompt got, never why (see TurnToolAccounting). Omitted rather than sent as
        // an empty array for a turn that ran no tools.
        const toolUsage = toToolUsage(accounting);

        await send(stream, {
            type: 'done',
            durationMs: Date.now() - startedAt,
            toolUsage: toolUsage.length > 0 ? toolUsage : undefined,
            // Worker spend, kept out of `usage` below on purpose - it never entered this
            // turn's context window, and context-window.ts reads that figure directly.
            subagents: toSubagentUsage(accounting),
            usage: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                // The cache half of the same input number (inputTokens already includes
                // both), normalized by the AI SDK from whatever the provider called it.
                // Forwarded so the CLI can show what a turn actually cost rather than
                // what it looks like it cost - and so a change to prompt assembly that
                // silently stops the prefix from caching shows up as these going to
                // zero, instead of only as a larger bill.
                cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
                cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
            },
        });
    } catch (error) {
        if (abortController.signal.aborted) return;

        await send(stream, {
            type: 'error',
            code: 'provider_error',
            message: error instanceof Error ? error.message : 'Unknown provider error',
        });
    }
}
