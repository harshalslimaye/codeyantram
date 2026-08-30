import { describe, expect, test } from "bun:test";
import {
    type ChatMessage,
    chatMessageSchema,
    chatModelIdSchema,
    chatRequestSchema,
    chatStreamEventSchema,
    effortLevelSchema,
    messagePartSchema,
    messagePartsSchema,
    providersResponseSchema,
    requestMessageSchema,
    toRequestMessage,
} from "../src/schemas";

const userMessage = {
    id: "m1",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "hello" }],
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
            model: "claude-sonnet-5",
            messages: [userMessage],
        });

        expect(result.success).toBe(true);
    });

    test("accepts an effort the model supports", () => {
        const result = chatRequestSchema.safeParse({
            model: "claude-opus-5",
            messages: [userMessage],
            effort: "max",
        });

        expect(result.success).toBe(true);
    });

    test("rejects an effort the model does not support", () => {
        // "max" is Anthropic-only - Gemini tops out at "high".
        const result = chatRequestSchema.safeParse({
            model: "gemini-3.5-flash",
            messages: [userMessage],
            effort: "max",
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["effort"]);
    });

    test("rejects any effort for a model with no effort control", () => {
        const result = chatRequestSchema.safeParse({
            model: "claude-haiku-4-5",
            messages: [userMessage],
            effort: "low",
        });

        expect(result.success).toBe(false);
    });

    test("accepts claude-haiku-4-5 when no effort is sent", () => {
        const result = chatRequestSchema.safeParse({
            model: "claude-haiku-4-5",
            messages: [userMessage],
        });

        expect(result.success).toBe(true);
    });

    test("rejects an assistant message that still carries reasoning", () => {
        const result = chatRequestSchema.safeParse({
            model: "claude-sonnet-5",
            messages: [
                userMessage,
                { id: "m2", role: "assistant", parts: [{ type: "reasoning", text: "replayed" }] },
            ],
        });

        expect(result.success).toBe(false);
    });

    test("rejects an empty message list", () => {
        expect(chatRequestSchema.safeParse({ model: "claude-sonnet-5", messages: [] }).success).toBe(false);
    });

    test("rejects an unknown model", () => {
        const result = chatRequestSchema.safeParse({ model: "gpt-9", messages: [userMessage] });
        expect(result.success).toBe(false);
    });
});

describe("chatStreamEventSchema", () => {
    test("accepts a start event", () => {
        expect(chatStreamEventSchema.safeParse({ type: "start", messageId: "m2" }).success).toBe(true);
    });

    test("rejects a start event with an empty messageId", () => {
        expect(chatStreamEventSchema.safeParse({ type: "start", messageId: "" }).success).toBe(false);
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

    test("accepts a done event", () => {
        expect(chatStreamEventSchema.safeParse({ type: "done", durationMs: 1234 }).success).toBe(true);
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
