import { describe, expect, test } from "bun:test";
import { contextUsage, latestUsageMessage } from "../src/context-window";
import { findSupportedChatModel } from "../src/models";
import type { AssistantMessage, ChatMessage, UserMessage } from "../src/schemas";

const sonnet = findSupportedChatModel("claude-sonnet-5")!; // contextWindow: 1_000_000

function userMessage(id: string, text = "hi"): UserMessage {
    return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantMessage(id: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
    return { id, role: "assistant", parts: [{ type: "text", text: "hello" }], ...overrides };
}

describe("contextUsage", () => {
    test("returns null with no messages", () => {
        expect(contextUsage([], sonnet)).toBeNull();
    });

    test("returns null when the only message is from the user", () => {
        const messages: ChatMessage[] = [userMessage("1")];
        expect(contextUsage(messages, sonnet)).toBeNull();
    });

    test("returns null when the assistant message has no usage yet (still streaming)", () => {
        const messages: ChatMessage[] = [userMessage("1"), assistantMessage("2")];
        expect(contextUsage(messages, sonnet)).toBeNull();
    });

    test("returns null when usage is present but inputTokens is omitted", () => {
        const messages: ChatMessage[] = [
            userMessage("1"),
            assistantMessage("2", { usage: { outputTokens: 40 } }),
        ];
        expect(contextUsage(messages, sonnet)).toBeNull();
    });

    test("reads inputTokens off the most recent assistant message that has it", () => {
        const messages: ChatMessage[] = [
            userMessage("1"),
            assistantMessage("2", { usage: { inputTokens: 5_000, outputTokens: 40 } }),
            userMessage("3"),
            assistantMessage("4", { usage: { inputTokens: 50_000, outputTokens: 80 } }),
        ];

        const usage = contextUsage(messages, sonnet);
        expect(usage).toEqual({ usedTokens: 50_000, contextWindow: 1_000_000, percent: 5 });
    });

    test("skips backward past a trailing assistant message still streaming with no usage", () => {
        const messages: ChatMessage[] = [
            userMessage("1"),
            assistantMessage("2", { usage: { inputTokens: 50_000, outputTokens: 80 } }),
            userMessage("3"),
            assistantMessage("4"), // no usage yet - this turn is still in flight
        ];

        const usage = contextUsage(messages, sonnet);
        expect(usage?.usedTokens).toBe(50_000);
    });

    test("skips backward past a message whose provider omitted inputTokens", () => {
        const messages: ChatMessage[] = [
            userMessage("1"),
            assistantMessage("2", { usage: { inputTokens: 50_000, outputTokens: 80 } }),
            userMessage("3"),
            assistantMessage("4", { usage: { outputTokens: 12 } }), // reported no inputTokens
        ];

        const usage = contextUsage(messages, sonnet);
        expect(usage?.usedTokens).toBe(50_000);
    });

    test("computes an unrounded percentage of the model's context window", () => {
        const messages: ChatMessage[] = [assistantMessage("1", { usage: { inputTokens: 1 } })];
        const usage = contextUsage(messages, sonnet);
        expect(usage?.percent).toBeCloseTo(0.0001, 6);
    });

    test("clamps percent at 100 when reported usage exceeds the model's context window", () => {
        const messages: ChatMessage[] = [assistantMessage("1", { usage: { inputTokens: 5_000_000 } })];
        const usage = contextUsage(messages, sonnet);
        expect(usage?.percent).toBe(100);
        expect(usage?.usedTokens).toBe(5_000_000); // the raw figure is preserved even though percent is clamped
    });

    test("every model in the catalog carries a positive contextWindow", () => {
        const opus = findSupportedChatModel("claude-opus-5")!;
        const messages: ChatMessage[] = [assistantMessage("1", { usage: { inputTokens: 100 } })];
        expect(contextUsage(messages, opus)?.contextWindow).toBeGreaterThan(0);
    });
});

describe("latestUsageMessage", () => {
    test("returns null with no messages", () => {
        expect(latestUsageMessage([])).toBeNull();
    });

    test("returns the whole message, not just its inputTokens", () => {
        const messages: ChatMessage[] = [
            assistantMessage("1", {
                usage: { inputTokens: 50_000, outputTokens: 80, cacheReadTokens: 40_000 },
                projectInstructions: { filename: "AGENTS.md", bytes: 900, truncated: false },
            }),
        ];

        const message = latestUsageMessage(messages);
        expect(message?.id).toBe("1");
        expect(message?.usage?.outputTokens).toBe(80);
        expect(message?.usage?.cacheReadTokens).toBe(40_000);
        expect(message?.projectInstructions?.filename).toBe("AGENTS.md");
    });

    test("is what contextUsage is built on - same message wins in both", () => {
        const messages: ChatMessage[] = [
            assistantMessage("1", { usage: { inputTokens: 5_000 } }),
            assistantMessage("2", { usage: { inputTokens: 50_000 } }),
        ];

        expect(latestUsageMessage(messages)?.id).toBe("2");
        expect(contextUsage(messages, sonnet)?.usedTokens).toBe(50_000);
    });
});
