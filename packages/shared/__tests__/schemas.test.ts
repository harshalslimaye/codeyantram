import { describe, expect, test } from "bun:test";
import {
    appendMessageRequestSchema,
    type ChatMessage,
    chatMessageSchema,
    chatModelIdSchema,
    chatRequestSchema,
    chatStreamEventSchema,
    createSessionRequestSchema,
    createSessionResponseSchema,
    effortLevelSchema,
    getSessionResponseSchema,
    listSessionsQuerySchema,
    listSessionsResponseSchema,
    messagePartSchema,
    messagePartsSchema,
    providersResponseSchema,
    renameSessionRequestSchema,
    requestMessageSchema,
    resolveApprovalRequestSchema,
    sessionActionResponseSchema,
    sessionSchema,
    sessionSummarySchema,
    toRequestMessage,
} from "../src/schemas";

const userMessage = {
    id: "m1",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "hello" }],
};

const baseRequest = {
    agent: "Talk" as const,
    cwd: "/repo",
};

describe("chatModelIdSchema", () => {
    test("accepts an id from the catalog", () => {
        expect(chatModelIdSchema.parse("gemini-3.5-flash")).toBe("gemini-3.5-flash");
    });

    test("rejects an unknown id", () => {
        expect(chatModelIdSchema.safeParse("gpt-9").success).toBe(false);
    });
});

describe("effortLevelSchema", () => {
    test("accepts every level in the catalog's union", () => {
        for (const level of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
            expect(effortLevelSchema.safeParse(level).success).toBe(true);
        }
    });

    test("rejects a level no provider defines", () => {
        expect(effortLevelSchema.safeParse("extreme").success).toBe(false);
    });
});

describe("providersResponseSchema", () => {
    test("accepts a subset of configured providers", () => {
        const result = providersResponseSchema.safeParse({ configuredProviders: ["anthropic"] });
        expect(result.success).toBe(true);
    });

    test("accepts none configured", () => {
        expect(providersResponseSchema.safeParse({ configuredProviders: [] }).success).toBe(true);
    });

    test("rejects an unknown provider", () => {
        const result = providersResponseSchema.safeParse({ configuredProviders: ["cohere"] });
        expect(result.success).toBe(false);
    });
});

describe("messagePartSchema", () => {
    test("accepts a text part", () => {
        expect(messagePartSchema.safeParse({ type: "text", text: "hi" }).success).toBe(true);
    });

    test("accepts a reasoning part", () => {
        expect(messagePartSchema.safeParse({ type: "reasoning", text: "thinking" }).success).toBe(true);
    });

    test("accepts a tool-call part with nested JSON args and no result yet", () => {
        const result = messagePartSchema.safeParse({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "read_file",
            args: { path: "src/index.ts", opts: { depth: 2, flags: [true, null] } },
        });

        expect(result.success).toBe(true);
    });

    test("accepts a tool-call part once its result is filled in", () => {
        const result = messagePartSchema.safeParse({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "read_file",
            args: {},
            result: "file contents",
        });

        expect(result.success).toBe(true);
    });

    test("rejects an unknown part type", () => {
        expect(messagePartSchema.safeParse({ type: "image", url: "x" }).success).toBe(false);
    });

    test("rejects a tool-call part missing its id", () => {
        const result = messagePartSchema.safeParse({ type: "tool-call", toolName: "ls", args: {} });
        expect(result.success).toBe(false);
    });

    test("accepts a tool-call part carrying approval fields", () => {
        const result = messagePartSchema.safeParse({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "bash",
            args: { command: "ls" },
            approvalId: "appr_1",
            approvalStatus: "pending",
        });

        expect(result.success).toBe(true);
    });

    test("rejects an unknown approvalStatus", () => {
        const result = messagePartSchema.safeParse({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "bash",
            args: {},
            approvalStatus: "maybe",
        });

        expect(result.success).toBe(false);
    });

    test("messagePartsSchema accepts a mixed list", () => {
        const result = messagePartsSchema.safeParse([
            { type: "reasoning", text: "planning" },
            { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} },
            { type: "text", text: "done" },
        ]);

        expect(result.success).toBe(true);
    });
});

describe("chatMessageSchema", () => {
    test("accepts a plain-text user message", () => {
        expect(chatMessageSchema.safeParse(userMessage).success).toBe(true);
    });

    test("rejects a user message carrying reasoning parts", () => {
        const result = chatMessageSchema.safeParse({
            id: "m1",
            role: "user",
            parts: [{ type: "reasoning", text: "the user did not think this" }],
        });

        expect(result.success).toBe(false);
    });

    test("rejects a user message carrying tool calls", () => {
        const result = chatMessageSchema.safeParse({
            id: "m1",
            role: "user",
            parts: [{ type: "tool-call", toolCallId: "c1", toolName: "rm", args: {} }],
        });

        expect(result.success).toBe(false);
    });

    test("rejects an empty user message", () => {
        expect(chatMessageSchema.safeParse({ id: "m1", role: "user", parts: [] }).success).toBe(false);
    });

    test("accepts an assistant message with reasoning, tool calls and text", () => {
        const result = chatMessageSchema.safeParse({
            id: "m2",
            role: "assistant",
            parts: [
                { type: "reasoning", text: "planning" },
                { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} },
                { type: "text", text: "done" },
            ],
        });

        expect(result.success).toBe(true);
    });

    test("accepts an assistant message with no parts yet (still streaming)", () => {
        expect(chatMessageSchema.safeParse({ id: "m2", role: "assistant", parts: [] }).success).toBe(true);
    });

    test("accepts an assistant message carrying projectInstructions metadata", () => {
        const result = chatMessageSchema.safeParse({
            id: "m2",
            role: "assistant",
            parts: [],
            projectInstructions: { filename: "AGENTS.md", bytes: 42, truncated: false },
        });

        expect(result.success).toBe(true);
    });

    test("accepts an assistant message with no projectInstructions field at all", () => {
        expect(chatMessageSchema.safeParse({ id: "m2", role: "assistant", parts: [], usage: { inputTokens: 1 } }).success).toBe(true);
    });

    test("rejects an unknown role", () => {
        expect(chatMessageSchema.safeParse({ id: "m1", role: "system", parts: [] }).success).toBe(false);
    });
});

describe("toRequestMessage", () => {
    test("strips reasoning parts from an assistant message", () => {
        const stored: ChatMessage = {
            id: "m2",
            role: "assistant",
            parts: [
                { type: "reasoning", text: "internal" },
                { type: "text", text: "visible" },
                { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} },
            ],
        };

        expect(toRequestMessage(stored).parts).toEqual([
            { type: "text", text: "visible" },
            { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} },
        ]);
    });

    test("its output always satisfies the request schema", () => {
        const stored: ChatMessage = {
            id: "m2",
            role: "assistant",
            parts: [{ type: "reasoning", text: "internal" }],
        };

        expect(requestMessageSchema.safeParse(toRequestMessage(stored)).success).toBe(true);
    });

    test("leaves a user message untouched", () => {
        expect(toRequestMessage(userMessage)).toEqual(userMessage);
    });
});

describe("chatRequestSchema", () => {
    test("accepts a request with no effort (provider default applies)", () => {
        const result = chatRequestSchema.safeParse({
            ...baseRequest,
            model: "claude-sonnet-5",
            messages: [userMessage],
        });

        expect(result.success).toBe(true);
    });

    test("accepts an effort the model supports", () => {
        const result = chatRequestSchema.safeParse({
            ...baseRequest,
            model: "claude-opus-5",
            messages: [userMessage],
            effort: "max",
        });

        expect(result.success).toBe(true);
    });

    test("rejects an effort the model does not support", () => {
        // "max" is Anthropic-only - Gemini tops out at "high".
        const result = chatRequestSchema.safeParse({
            ...baseRequest,
            model: "gemini-3.5-flash",
            messages: [userMessage],
            effort: "max",
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["effort"]);
    });

    test("rejects any effort for a model with no effort control", () => {
        const result = chatRequestSchema.safeParse({
            ...baseRequest,
            model: "claude-haiku-4-5",
            messages: [userMessage],
            effort: "low",
        });

        expect(result.success).toBe(false);
    });

    test("accepts claude-haiku-4-5 when no effort is sent", () => {
        const result = chatRequestSchema.safeParse({
            ...baseRequest,
            model: "claude-haiku-4-5",
            messages: [userMessage],
        });

        expect(result.success).toBe(true);
    });

    test("rejects an assistant message that still carries reasoning", () => {
        const result = chatRequestSchema.safeParse({
            ...baseRequest,
            model: "claude-sonnet-5",
            messages: [
                userMessage,
                { id: "m2", role: "assistant", parts: [{ type: "reasoning", text: "replayed" }] },
            ],
        });

        expect(result.success).toBe(false);
    });

    test("rejects an empty message list", () => {
        const result = chatRequestSchema.safeParse({ ...baseRequest, model: "claude-sonnet-5", messages: [] });
        expect(result.success).toBe(false);
    });

    test("rejects an unknown model", () => {
        const result = chatRequestSchema.safeParse({ ...baseRequest, model: "gpt-9", messages: [userMessage] });
        expect(result.success).toBe(false);
    });

    test("rejects a request missing cwd", () => {
        const result = chatRequestSchema.safeParse({
            agent: "Talk",
            model: "claude-sonnet-5",
            messages: [userMessage],
        });

        expect(result.success).toBe(false);
    });

    test("rejects a request with an unknown agent", () => {
        const result = chatRequestSchema.safeParse({
            ...baseRequest,
            agent: "Debug",
            model: "claude-sonnet-5",
            messages: [userMessage],
        });

        expect(result.success).toBe(false);
    });

    test("accepts a request with no useProjectInstructions (defaults to enabled)", () => {
        const result = chatRequestSchema.safeParse({
            ...baseRequest,
            model: "claude-sonnet-5",
            messages: [userMessage],
        });

        expect(result.success).toBe(true);
    });

    test("accepts useProjectInstructions: false, the off-switch", () => {
        const result = chatRequestSchema.safeParse({
            ...baseRequest,
            model: "claude-sonnet-5",
            messages: [userMessage],
            useProjectInstructions: false,
        });

        expect(result.success).toBe(true);
    });
});

const baseSummary = {
    id: "s1",
    project: "/repo",
    title: "hello",
    createdAt: 1,
    updatedAt: 2,
    modelId: "claude-sonnet-5",
    agentName: "Build",
    effort: "high",
    messageCount: 1,
};

describe("sessionSummarySchema", () => {
    test("accepts a well-formed summary", () => {
        expect(sessionSummarySchema.safeParse(baseSummary).success).toBe(true);
    });

    test("accepts a null effort", () => {
        expect(sessionSummarySchema.safeParse({ ...baseSummary, effort: null }).success).toBe(true);
    });

    test("accepts a modelId/agentName no longer in the current catalog - unlike chatRequestSchema, this is not validated against it", () => {
        const result = sessionSummarySchema.safeParse({
            ...baseSummary,
            modelId: "some-retired-model",
            agentName: "SomeRetiredAgent",
        });
        expect(result.success).toBe(true);
    });

    test("rejects a missing required field", () => {
        const { title, ...withoutTitle } = baseSummary;
        expect(sessionSummarySchema.safeParse(withoutTitle).success).toBe(false);
    });
});

describe("sessionSchema", () => {
    test("extends the summary with a messages array, reasoning parts included", () => {
        const result = sessionSchema.safeParse({
            ...baseSummary,
            messages: [
                userMessage,
                { id: "m2", role: "assistant", parts: [{ type: "reasoning", text: "thinking" }, { type: "text", text: "done" }] },
            ],
        });
        expect(result.success).toBe(true);
    });

    test("rejects a message that doesn't satisfy chatMessageSchema", () => {
        const result = sessionSchema.safeParse({ ...baseSummary, messages: [{ id: "m1", role: "user", parts: [] }] });
        expect(result.success).toBe(false);
    });
});

describe("createSessionRequestSchema", () => {
    const baseCreate = { cwd: "/repo", agent: "Build" as const, model: "claude-sonnet-5", firstMessage: userMessage };

    test("accepts a request with no effort", () => {
        expect(createSessionRequestSchema.safeParse(baseCreate).success).toBe(true);
    });

    test("accepts an effort the model supports", () => {
        expect(createSessionRequestSchema.safeParse({ ...baseCreate, model: "claude-opus-5", effort: "max" }).success).toBe(true);
    });

    test("rejects an effort the model does not support - the same catalog check chatRequestSchema does", () => {
        const result = createSessionRequestSchema.safeParse({ ...baseCreate, model: "gemini-3.5-flash", effort: "max" });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["effort"]);
    });

    test("rejects an unknown model - unlike sessionSummarySchema, this validates against the live catalog", () => {
        expect(createSessionRequestSchema.safeParse({ ...baseCreate, model: "gpt-9" }).success).toBe(false);
    });

    test("rejects a firstMessage that isn't a user message", () => {
        const result = createSessionRequestSchema.safeParse({
            ...baseCreate,
            firstMessage: { id: "m1", role: "assistant", parts: [{ type: "text", text: "hi" }] },
        });
        expect(result.success).toBe(false);
    });

    test("rejects a missing cwd", () => {
        const { cwd: _cwd, ...withoutCwd } = baseCreate;
        expect(createSessionRequestSchema.safeParse(withoutCwd).success).toBe(false);
    });
});

describe("createSessionResponseSchema", () => {
    test("accepts an id and title", () => {
        expect(createSessionResponseSchema.safeParse({ id: "s1", title: "hello" }).success).toBe(true);
    });

    test("rejects an empty id", () => {
        expect(createSessionResponseSchema.safeParse({ id: "", title: "hello" }).success).toBe(false);
    });

    test("rejects an empty title", () => {
        expect(createSessionResponseSchema.safeParse({ id: "s1", title: "" }).success).toBe(false);
    });

    test("rejects a missing title", () => {
        expect(createSessionResponseSchema.safeParse({ id: "s1" }).success).toBe(false);
    });
});

describe("listSessionsQuerySchema", () => {
    test("accepts a project", () => {
        expect(listSessionsQuerySchema.safeParse({ project: "/repo" }).success).toBe(true);
    });

    test("rejects a missing project", () => {
        expect(listSessionsQuerySchema.safeParse({}).success).toBe(false);
    });
});

describe("listSessionsResponseSchema", () => {
    test("accepts an empty list", () => {
        expect(listSessionsResponseSchema.safeParse({ sessions: [] }).success).toBe(true);
    });

    test("accepts a list of summaries", () => {
        expect(listSessionsResponseSchema.safeParse({ sessions: [baseSummary] }).success).toBe(true);
    });

    test("rejects a bare array (must be wrapped)", () => {
        expect(listSessionsResponseSchema.safeParse([baseSummary]).success).toBe(false);
    });
});

describe("getSessionResponseSchema", () => {
    test("accepts a wrapped session", () => {
        expect(getSessionResponseSchema.safeParse({ session: { ...baseSummary, messages: [userMessage] } }).success).toBe(true);
    });
});

describe("appendMessageRequestSchema", () => {
    test("accepts a wrapped user message", () => {
        expect(appendMessageRequestSchema.safeParse({ message: userMessage }).success).toBe(true);
    });

    test("accepts a wrapped assistant message with usage", () => {
        const message = { id: "m2", role: "assistant" as const, parts: [{ type: "text" as const, text: "hi" }], usage: { inputTokens: 4 } };
        expect(appendMessageRequestSchema.safeParse({ message }).success).toBe(true);
    });
});

describe("resolveApprovalRequestSchema", () => {
    test("accepts a toolCallId and approved flag", () => {
        expect(resolveApprovalRequestSchema.safeParse({ toolCallId: "call_1", approved: true }).success).toBe(true);
    });

    test("rejects a missing toolCallId", () => {
        expect(resolveApprovalRequestSchema.safeParse({ approved: true }).success).toBe(false);
    });
});

describe("renameSessionRequestSchema", () => {
    test("accepts a title", () => {
        expect(renameSessionRequestSchema.safeParse({ title: "new title" }).success).toBe(true);
    });

    test("rejects an empty title (whitespace-only is the store's job - see @codeyantram/sessions)", () => {
        expect(renameSessionRequestSchema.safeParse({ title: "" }).success).toBe(false);
    });
});

describe("sessionActionResponseSchema", () => {
    test("accepts { ok: true }", () => {
        expect(sessionActionResponseSchema.safeParse({ ok: true }).success).toBe(true);
    });

    test("rejects { ok: false }", () => {
        expect(sessionActionResponseSchema.safeParse({ ok: false }).success).toBe(false);
    });
});

describe("chatStreamEventSchema", () => {
    test("accepts a start event", () => {
        expect(chatStreamEventSchema.safeParse({ type: "start", messageId: "m2" }).success).toBe(true);
    });

    test("rejects a start event with an empty messageId", () => {
        expect(chatStreamEventSchema.safeParse({ type: "start", messageId: "" }).success).toBe(false);
    });

    test("accepts a start event carrying project instructions metadata", () => {
        const result = chatStreamEventSchema.safeParse({
            type: "start",
            messageId: "m2",
            projectInstructions: { filename: "AGENTS.md", bytes: 42, truncated: false },
        });

        expect(result.success).toBe(true);
    });

    test("rejects project instructions metadata with a negative byte count", () => {
        const result = chatStreamEventSchema.safeParse({
            type: "start",
            messageId: "m2",
            projectInstructions: { filename: "AGENTS.md", bytes: -1, truncated: false },
        });

        expect(result.success).toBe(false);
    });

    test("accepts each delta event", () => {
        expect(chatStreamEventSchema.safeParse({ type: "text-delta", text: "hi" }).success).toBe(true);
        expect(chatStreamEventSchema.safeParse({ type: "reasoning-delta", text: "hm" }).success).toBe(true);
    });

    test("accepts a tool-call and its matching tool-result", () => {
        expect(
            chatStreamEventSchema.safeParse({
                type: "tool-call",
                toolCallId: "c1",
                toolName: "ls",
                args: { path: "." },
            }).success,
        ).toBe(true);

        expect(
            chatStreamEventSchema.safeParse({ type: "tool-result", toolCallId: "c1", result: "ok" }).success,
        ).toBe(true);
    });

    test("accepts a tool-approval-request event", () => {
        const result = chatStreamEventSchema.safeParse({
            type: "tool-approval-request",
            toolCallId: "c1",
            approvalId: "appr-1",
        });

        expect(result.success).toBe(true);
    });

    test("accepts a done event", () => {
        expect(chatStreamEventSchema.safeParse({ type: "done", durationMs: 1234 }).success).toBe(true);
    });

    test("accepts a done event whose usage carries prompt-cache counts", () => {
        const result = chatStreamEventSchema.safeParse({
            type: "done",
            durationMs: 1234,
            usage: { inputTokens: 48200, outputTokens: 1300, cacheReadTokens: 46100, cacheWriteTokens: 1900 },
        });

        expect(result.success).toBe(true);
    });

    test("accepts a done event from a provider that reports no cache counts", () => {
        const result = chatStreamEventSchema.safeParse({
            type: "done",
            durationMs: 1234,
            usage: { inputTokens: 10, outputTokens: 2 },
        });

        expect(result.success).toBe(true);
    });

    test("accepts an error event carrying a known code", () => {
        const result = chatStreamEventSchema.safeParse({
            type: "error",
            code: "rate_limited",
            message: "slow down",
        });

        expect(result.success).toBe(true);
    });

    test("accepts a missing_credentials error, the user-fixable case", () => {
        const result = chatStreamEventSchema.safeParse({
            type: "error",
            code: "missing_credentials",
            message: "OPENAI_API_KEY is not set",
        });

        expect(result.success).toBe(true);
    });

    test("rejects an error event with an unknown code", () => {
        const result = chatStreamEventSchema.safeParse({ type: "error", code: "kaboom", message: "x" });
        expect(result.success).toBe(false);
    });

    test("rejects an unknown event type", () => {
        expect(chatStreamEventSchema.safeParse({ type: "heartbeat" }).success).toBe(false);
    });

    test("survives a JSON round trip, as it will over SSE", () => {
        const event = { type: "text-delta" as const, text: "hello" };
        const parsed = chatStreamEventSchema.parse(JSON.parse(JSON.stringify(event)));

        expect(parsed).toEqual(event);
    });
});
