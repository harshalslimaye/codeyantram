import { z } from "zod";
import { AGENT_NAMES } from "./agents";
import {
    EFFORT_LEVELS,
    SUPPORTED_PROVIDERS,
    findSupportedChatModel,
    modelSupportsEffort,
    type EffortLevel,
} from "./models";

export const effortLevelSchema = z.enum(EFFORT_LEVELS);
// Not z.enum(SUPPORTED_CHAT_MODEL_IDS): that would only ever admit the static catalog's
// four hosted providers, and OpenRouter's ids are fetched live from OpenRouter's own
// catalog (see the server's openrouter-models module) - this package has no synchronous
// way to enumerate them. checkModelAndEffort below validates what it can (the static
// catalog); an OpenRouter id is checked for real at resolution time, server-side.
export const chatModelIdSchema = z.string().min(1);
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
// Models
// ---------------------------------------------------------------------------

// One model as this app describes it - not OpenRouter's raw API shape (id, name,
// context_length, pricing, supported_parameters, ...), which stays entirely inside the
// server's own openrouter-models module. This is the wire contract for GET /models: the
// CLI only ever needs to know a model in codeyantram's own vocabulary, the same shape the
// static catalog already uses (see SupportedChatModelDefinition in models.ts).
export const chatModelDefinitionSchema = z.object({
    id: z.string().min(1),
    provider: providerSchema,
    supportedEffortLevels: z.array(effortLevelSchema),
    defaultEffortLevel: effortLevelSchema.optional(),
    contextWindow: z.number().int().positive(),
});

// Response for GET /models: every OpenRouter model the server's live fetch currently
// knows about. Deliberately not the static catalog too - the CLI already has that at
// build time (SUPPORTED_CHAT_MODELS), so this only ever carries what it can't otherwise
// know, the same "don't resend what the client already has" reasoning providersResponseSchema's
// own comment gives for leaving the model catalog out of GET /providers.
export const modelsResponseSchema = z.object({
    models: z.array(chatModelDefinitionSchema),
});

export type ModelsResponse = z.infer<typeof modelsResponseSchema>;

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
    // The whole prompt, cached or not: inputTokens = uncached + cacheReadTokens +
    // cacheWriteTokens. The cache fields below are a breakdown of this number, never
    // an addition to it - don't sum them with it.
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    // Prompt-cache activity for this turn: tokens served from cache (billed at a
    // fraction of the input rate) and tokens written into it. Every supported provider
    // reports this under its own name - Anthropic cache_read_input_tokens, OpenAI
    // prompt_tokens_details.cached_tokens, Google cachedContentTokenCount, DeepSeek
    // prompt_cache_hit_tokens - which the AI SDK normalizes into one shape for the
    // server to forward (see chat-stream.ts). Optional like the rest: a provider that
    // reports neither simply omits them.
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
});

export type TokenUsage = z.infer<typeof tokenUsageSchema>;

// What each tool actually put into the conversation during one assistant turn.
//
// Distinct from tokenUsageSchema above, and not derivable from it: that reports the size
// of the *whole* prompt as the provider counted it, which says nothing about which tool's
// output made it that size. Every tool result is replayed verbatim on every later request
// (see toolPartsToMessages in the server's chat-stream), so a turn's tool output is not a
// one-off cost - it is carried for the rest of the session. This is the per-tool
// attribution that makes that visible.
//
// resultChars, not tokens: tokenizing here would mean shipping a tokenizer per provider
// for a number only ever used as a ratio. Callers that want an approximation divide by 4
// and say so - never present it as a measured token count.
export const toolUsageSchema = z.object({
    // Plain string, matching toolCallPartSchema.toolName below rather than toolNameSchema:
    // this is a record of what ran, and a stored session naming a tool the catalog has
    // since dropped should still parse.
    toolName: z.string(),
    calls: z.number().int().nonnegative(),
    resultChars: z.number().int().nonnegative(),
});

export type ToolUsage = z.infer<typeof toolUsageSchema>;

// What the turn's subagents cost. Deliberately a separate field from tokenUsageSchema
// rather than folded into it: that one means "how big this turn's prompt was", which
// context-window.ts reads directly to say how full the window is - and worker tokens are
// real spend that never enters the orchestrator's window at all. Summing them in would
// overstate the window and quietly break the one reading the footer is built on.
//
// This is also the figure that makes the whole subagent trade visible: workers can burn
// far more tokens than they return, and without it that spend is invisible in a UI whose
// only number is the context percentage.
export const subagentUsageSchema = z.object({
    // Workers actually spawned this turn - not tool calls made, and not capped-out
    // attempts, which cost nothing and never reach a model.
    count: z.number().int().nonnegative(),
    // Summed across every worker in the turn, each of which ran its own multi-step loop.
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
});

export type SubagentUsage = z.infer<typeof subagentUsageSchema>;

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

// Metadata about the instruction file (if any) loaded for a turn - never the file's own
// text, just enough for the CLI to show what's active and warn once if it got cut. See
// project-instructions.ts on the server for what produces this.
export const projectInstructionsMetaSchema = z.object({
    filename: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
});

export type ProjectInstructionsMeta = z.infer<typeof projectInstructionsMetaSchema>;

// Assistant parts may legitimately be empty while a response is still
// streaming, so no .min() here.
export const assistantMessageSchema = z.object({
    id: z.string().min(1),
    role: z.literal("assistant"),
    parts: messagePartsSchema,
    // Filled in once the matching "done" event arrives, so usage travels
    // with the message it belongs to rather than living only on the wire.
    usage: tokenUsageSchema.optional(),
    // Per-tool output attribution for this turn, from the same "done" event as usage
    // above and travelling with the message for the same reason. One entry per tool that
    // ran; absent for a turn that used none.
    toolUsage: z.array(toolUsageSchema).optional(),
    // What this turn's workers spent (see subagentUsageSchema). Absent for a turn that
    // spawned none - which is most of them.
    subagents: subagentUsageSchema.optional(),
    // Filled in from the "start" event that opened this message's turn - absent if that
    // turn had none. Travels with the message (like usage above) so a per-turn cost
    // summary can show both together, rather than only reflecting whichever turn is most
    // recent.
    projectInstructions: projectInstructionsMetaSchema.optional(),
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

// Shared by chatRequestSchema and createSessionRequestSchema below: both accept a bare
// model id and an optional effort. Only the static catalog can be checked synchronously
// here - an id this package doesn't recognize isn't rejected, since it may be a live-fetched
// OpenRouter model (see chatModelIdSchema's own comment above); the server's
// resolveChatModel is the actual source of truth for those, at resolution time.
function checkEffortAgainstModel(
    modelId: string | undefined,
    effort: EffortLevel | undefined,
    ctx: z.RefinementCtx,
    path: string,
): void {
    if (effort === undefined || modelId === undefined) return;

    const model = findSupportedChatModel(modelId);
    if (model === undefined) return;

    if (!modelSupportsEffort(model, effort)) {
        ctx.addIssue({
            code: "custom",
            message: "This model does not support the requested effort level",
            path: [path],
        });
    }
}

// Both model/effort pairs get the same check, independently: the worker can be a different
// model from the orchestrator, on a different provider, with a different set of supported
// effort levels - so validating one pair says nothing about the other.
function checkModelAndEffort(
    request: { model: string; effort?: EffortLevel; workerModel?: string; workerEffort?: EffortLevel },
    ctx: z.RefinementCtx,
): void {
    checkEffortAgainstModel(request.model, request.effort, ctx, "effort");
    checkEffortAgainstModel(request.workerModel, request.workerEffort, ctx, "workerEffort");
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
        // Off-switch for the project's AGENTS.md/CLAUDE.md (see
        // project-instructions.ts on the server). Omitted or true loads it as
        // usual; false skips the read entirely for this turn without the user
        // having to rename or delete the file. Defaults to enabled so a client
        // that doesn't send this field sees no change in behavior.
        useProjectInstructions: z.boolean().optional(),
        // Which model the turn's subagent workers run on (see the explore tool). Optional:
        // a client that has never opened the worker picker sends nothing and the server
        // falls back to DEFAULT_WORKER_MODEL_ID. Validated as a plain model id like `model`
        // above - a worker may be any model the orchestrator may be, OpenRouter ids
        // included, since both resolve through the same server-side path.
        workerModel: chatModelIdSchema.optional(),
        // The worker model's own effort level, checked against workerModel rather than
        // model. Sent by the client rather than looked up server-side because preferences
        // live CLI-side (see effortByModel in the CLI's preferences.ts) - the server has no
        // access to them. Omitted for a worker model that takes no effort parameter at all,
        // which is the default one's case.
        workerEffort: effortLevelSchema.optional(),
    })
    .superRefine(checkModelAndEffort);

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ---------------------------------------------------------------------------
// Sessions
//
// The wire contract for the session API (packages/server/src/routers/sessions.ts) -
// storage itself (schema, migrations, queries) lives in @codeyantram/sessions, which
// never imports from here for its own row shapes. These schemas exist because a session
// now crosses the CLI/server boundary, the same reason chatRequestSchema lives here
// rather than being defined once per side.
// ---------------------------------------------------------------------------

// modelId/agentName/effort are plain, uncatalogued strings here - deliberately not
// chatModelIdSchema/agentNameSchema/effortLevelSchema, and this is the one place in this
// file that reuses a "shape" without reusing its validation. A session response can
// describe one created months ago against a model or agent since removed from the
// catalog, and it must still parse: the CLI's own resume flow (falling back to the
// current default and telling the user, rather than refusing to open the session) can
// only run once the data has actually been read back successfully. Catalog validation
// still applies - just only going *in*, on createSessionRequestSchema below, where the
// session is being created against the catalog as it exists right now.
export const sessionSummarySchema = z.object({
    id: z.string().min(1),
    project: z.string().min(1),
    title: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    modelId: z.string().min(1),
    agentName: z.string().min(1),
    effort: z.string().min(1).nullable(),
    messageCount: z.number().int().nonnegative(),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;

// The full transcript, in seq order - what GET /sessions/:id returns. Reasoning parts
// are included: they render on resume the same way they do live, and toRequestMessage
// strips them again on the way back out to a provider, same as it always has.
export const sessionSchema = sessionSummarySchema.extend({
    messages: z.array(chatMessageSchema),
});

export type Session = z.infer<typeof sessionSchema>;

// POST /sessions. Unlike the response schemas above, this validates against the live
// catalogs - a session is being created right now, so it should use a model/agent/effort
// combination the server actually supports today, exactly as chatRequestSchema already
// requires for an ordinary turn. firstMessage is a UserMessage specifically (not
// ChatMessage): a session always opens with one, matching
// @codeyantram/sessions' NewSessionInput and the CLI's own "never create a session for
// an empty conversation" rule.
export const createSessionRequestSchema = z
    .object({
        cwd: z.string().min(1),
        model: chatModelIdSchema,
        agent: agentNameSchema,
        effort: effortLevelSchema.optional(),
        firstMessage: userMessageSchema,
    })
    .superRefine(checkModelAndEffort);

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

// title travels back here (not just on GET/list) so the CLI can show it (see
// session.tsx) the instant a session is created, without a second round trip just to
// learn what the server-derived title turned out to be.
export const createSessionResponseSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
});

export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

// GET /sessions?project=<cwd>
export const listSessionsQuerySchema = z.object({
    project: z.string().min(1),
});

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

// Wrapped in a named field rather than a bare top-level array, matching
// providersResponseSchema's own convention - room to add e.g. pagination metadata later
// without a breaking response-shape change.
export const listSessionsResponseSchema = z.object({
    sessions: z.array(sessionSummarySchema),
});

export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;

// GET /sessions/:id. "Not found" is a 404 with an ad hoc error body (see chatRequestSchema's
// own validation-failure response), not a shape this schema describes - this only covers
// the success case, same division providersResponseSchema draws.
export const getSessionResponseSchema = z.object({
    session: sessionSchema,
});

export type GetSessionResponse = z.infer<typeof getSessionResponseSchema>;

// POST /sessions/:id/messages. The message is expected to already be finished (an
// assistant message carries its usage, if it has any) - the store only ever accepts one
// insert per message, never a partial one to patch later; see @codeyantram/sessions'
// own "a row is inserted once, when it is final" rule.
export const appendMessageRequestSchema = z.object({
    message: chatMessageSchema,
});

export type AppendMessageRequest = z.infer<typeof appendMessageRequestSchema>;

// POST /sessions/:id/approvals
export const resolveApprovalRequestSchema = z.object({
    toolCallId: z.string().min(1),
    approved: z.boolean(),
});

export type ResolveApprovalRequest = z.infer<typeof resolveApprovalRequestSchema>;

// PATCH /sessions/:id. The store trims and rejects an all-whitespace title on its own
// (see renameSession in @codeyantram/sessions); .min(1) here only catches the cheaper,
// literally-empty case at the schema layer, the same division of labor
// chatRequestSchema's structural checks vs. its .refine() already draws.
export const renameSessionRequestSchema = z.object({
    title: z.string().min(1),
});

export type RenameSessionRequest = z.infer<typeof renameSessionRequestSchema>;

// The uniform success response for every session route that has nothing more
// interesting to report than "it worked" - append, resolve, rename, delete. One shared
// shape rather than four identical ones.
export const sessionActionResponseSchema = z.object({
    ok: z.literal(true),
});

export type SessionActionResponse = z.infer<typeof sessionActionResponseSchema>;

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
        // Present only when a project instruction file was actually loaded for this
        // turn - absent if there was none, or useProjectInstructions was false.
        projectInstructions: projectInstructionsMetaSchema.optional(),
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
        // One entry per tool that ran this turn (see toolUsageSchema). Omitted entirely
        // when no tool ran, rather than sent as an empty array.
        toolUsage: z.array(toolUsageSchema).optional(),
        // Worker spend for this turn (see subagentUsageSchema). Omitted when none ran.
        subagents: subagentUsageSchema.optional(),
    }),
    z.object({
        type: z.literal("error"),
        code: chatErrorCodeSchema,
        message: z.string(),
    }),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
