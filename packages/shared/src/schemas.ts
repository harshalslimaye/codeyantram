import { z } from "zod";
import { AGENT_NAMES } from "./agents";
import {
    EFFORT_LEVELS,
    SUPPORTED_CHAT_MODEL_IDS,
    SUPPORTED_PROVIDERS,
    findSupportedChatModel,
    modelSupportsEffort,
} from "./models";

export const effortLevelSchema = z.enum(EFFORT_LEVELS);
export const chatModelIdSchema = z.enum(SUPPORTED_CHAT_MODEL_IDS);
export const providerSchema = z.enum(SUPPORTED_PROVIDERS);
export const agentNameSchema = z.enum(AGENT_NAMES);

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// Response for GET /providers. Deliberately not the model catalog: both sides
// import it from this package already, so the only thing the CLI cannot work
// out for itself is which API keys the server actually has. Pair this with
// isModelAvailable() to decide what the /models picker can offer.
export const providersResponseSchema = z.object({
    configuredProviders: z.array(providerSchema),
});

export type ProvidersResponse = z.infer<typeof providersResponseSchema>;

// ---------------------------------------------------------------------------
// Message parts
// ---------------------------------------------------------------------------

export const toolCallArgsSchema = z.record(z.string(), z.json());

export const textPartSchema = z.object({
    type: z.literal("text"),
    text: z.string(),
});

export const reasoningPartSchema = z.object({
    type: z.literal("reasoning"),
    text: z.string(),
});

export const toolApprovalStatusSchema = z.enum(["pending", "approved", "denied"]);

export type ToolApprovalStatus = z.infer<typeof toolApprovalStatusSchema>;

// Token counts for one assistant turn, as reported by the provider once the
// stream finishes. Fields are optional because not every provider reports
// every count (e.g. totalTokens isn't always broken out).
export const tokenUsageSchema = z.object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
});

export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const toolCallPartSchema = z.object({
    type: z.literal("tool-call"),
    // Named to match the "tool-call"/"tool-result" stream events, so folding an
    // event into a part never needs a rename step.
    toolCallId: z.string(),
    toolName: z.string(),
    args: toolCallArgsSchema,
    // Filled in once the matching "tool-result" event arrives, so a completed
    // call and its output live in one part rather than two.
    result: z.string().optional(),
    // Only present for a tool that needs approval (see toolNeedsApproval). "pending" once the
    // server's "tool-approval-request" event arrives; the CLI sets it to
    // "approved"/"denied" once the user decides, before replaying it in the
    // next request's history.
    approvalId: z.string().optional(),
    approvalStatus: toolApprovalStatusSchema.optional(),
});

export const messagePartSchema = z.discriminatedUnion("type", [
    textPartSchema,
    reasoningPartSchema,
    toolCallPartSchema,
]);

export const messagePartsSchema = z.array(messagePartSchema);

export type TextPart = z.infer<typeof textPartSchema>;
export type ReasoningPart = z.infer<typeof reasoningPartSchema>;
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;
export type MessagePart = z.infer<typeof messagePartSchema>;

// ---------------------------------------------------------------------------
// Messages (as stored and rendered by the CLI)
// ---------------------------------------------------------------------------

// A user message only ever comes from the input bar, so it is plain text -
// there is no path by which a client should be submitting reasoning or tool
// calls authored as the user.
export const userMessageSchema = z.object({
    id: z.string().min(1),
    role: z.literal("user"),
    parts: z.array(textPartSchema).min(1),
});

// Assistant parts may legitimately be empty while a response is still
// streaming, so no .min() here.
export const assistantMessageSchema = z.object({
    id: z.string().min(1),
    role: z.literal("assistant"),
    parts: messagePartsSchema,
    // Filled in once the matching "done" event arrives, so usage travels
    // with the message it belongs to rather than living only on the wire.
    usage: tokenUsageSchema.optional(),
});

export const chatMessageSchema = z.discriminatedUnion("role", [
    userMessageSchema,
    assistantMessageSchema,
]);

export type UserMessage = z.infer<typeof userMessageSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

// Reasoning is display-only and is never sent back up. Anthropic requires
// thinking blocks be echoed back unchanged, and they carry a signature this
// format does not keep - so replaying a text-only copy of the model's
// reasoning is worse than omitting it entirely. `toRequestMessage` below does
// the stripping; this schema makes a mistake there a parse error rather than a
// subtle multi-turn bug.
export const requestAssistantMessageSchema = z.object({
    id: z.string().min(1),
    role: z.literal("assistant"),
    parts: z.array(z.discriminatedUnion("type", [textPartSchema, toolCallPartSchema])),
});

export const requestMessageSchema = z.discriminatedUnion("role", [
    userMessageSchema,
    requestAssistantMessageSchema,
]);

export type RequestMessage = z.infer<typeof requestMessageSchema>;

/** Drops the parts that must not be replayed to the provider (see above). */
export function toRequestMessage(message: ChatMessage): RequestMessage {
    if (message.role === "user") return message;

    return {
        ...message,
        parts: message.parts.filter(
            (part): part is TextPart | ToolCallPart => part.type !== "reasoning",
        ),
    };
}

// What the CLI POSTs to the local server. `effort` is optional - omitting it
// lets each provider apply its own default (see defaultEffortLevel in
// models.ts). `agent` and `cwd` are required: the server needs to know
// whether tools are allowed at all (agentHasTools) and, if so, which project
// root to resolve every tool's paths against.
export const chatRequestSchema = z
    .object({
        model: chatModelIdSchema,
        messages: z.array(requestMessageSchema).min(1),
        effort: effortLevelSchema.optional(),
        agent: agentNameSchema,
        cwd: z.string().min(1),
    })
    .refine(
        request => {
            if (request.effort === undefined) return true;
            const model = findSupportedChatModel(request.model);
            return model !== undefined && modelSupportsEffort(model, request.effort);
        },
        {
            message: "This model does not support the requested effort level",
            path: ["effort"],
        },
    );

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ---------------------------------------------------------------------------
// Stream events
// ---------------------------------------------------------------------------

// Coarse enough for the CLI to decide how to surface a failure (a warn toast
// for something the user can correct, an error toast for everything else)
// without parsing message text.
export const chatErrorCodeSchema = z.enum([
    "invalid_request",
    // The selected model's provider has no API key set. Distinct from
    // provider_error because the user can fix it themselves, and the CLI can
    // name the exact variable via PROVIDER_ENV_VARS.
    "missing_credentials",
    "rate_limited",
    "provider_error",
    "internal_error",
]);

export type ChatErrorCode = z.infer<typeof chatErrorCodeSchema>;

// Framed as SSE over the wire: one JSON event per `data:` line.
//
// A stream always opens with "start" and, when it runs to completion, closes
// with "done" or "error". A connection that closes with neither means the
// request was aborted (the user interrupting mid-response) - that is a normal
// outcome here, not a failure, and carries no event of its own because
// closing the connection is the signal.
export const chatStreamEventSchema = z.discriminatedUnion("type", [
    z.object({
        // Sent before any content, so the CLI has an id for the assistant
        // message it is about to render into rather than learning it at the end.
        type: z.literal("start"),
        messageId: z.string().min(1),
    }),
    z.object({
        type: z.literal("text-delta"),
        text: z.string(),
    }),
    z.object({
        type: z.literal("reasoning-delta"),
        text: z.string(),
    }),
    z.object({
        type: z.literal("tool-call"),
        toolCallId: z.string(),
        toolName: z.string(),
        args: toolCallArgsSchema,
    }),
    z.object({
        type: z.literal("tool-result"),
        toolCallId: z.string(),
        result: z.string(),
    }),
    // Sent instead of an eventual "tool-result" when the tool needs approval
    // before it can run - the turn ends here, and the CLI must resolve the
    // approval and start a new turn to get a "tool-result" for this call.
    z.object({
        type: z.literal("tool-approval-request"),
        toolCallId: z.string(),
        approvalId: z.string(),
    }),
    z.object({
        type: z.literal("done"),
        durationMs: z.number(),
        usage: tokenUsageSchema.optional(),
    }),
    z.object({
        type: z.literal("error"),
        code: chatErrorCodeSchema,
        message: z.string(),
    }),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
