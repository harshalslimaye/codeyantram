import { describe, expect, test } from "bun:test";
import type { ChatStreamEvent, MessagePart } from "../src/schemas";
import { messagePartsSchema } from "../src/schemas";
import { applyStreamEvent } from "../src/stream";

/** Folds a whole stream, the way a caller consuming SSE would. */
function fold(events: ChatStreamEvent[]): MessagePart[] {
    return events.reduce<MessagePart[]>(applyStreamEvent, []);
}

describe("text deltas", () => {
    test("consecutive text deltas merge into one part", () => {
        const parts = fold([
            { type: "text-delta", text: "Hel" },
            { type: "text-delta", text: "lo " },
            { type: "text-delta", text: "world" },
        ]);

        expect(parts).toEqual([{ type: "text", text: "Hello world" }]);
    });

    test("the first delta starts a part on an empty list", () => {
        expect(applyStreamEvent([], { type: "text-delta", text: "hi" })).toEqual([
            { type: "text", text: "hi" },
        ]);
    });
});

describe("mixing delta kinds", () => {
    test("reasoning and text deltas stay separate parts", () => {
        const parts = fold([
            { type: "reasoning-delta", text: "let me " },
            { type: "reasoning-delta", text: "think" },
            { type: "text-delta", text: "the answer" },
        ]);

        expect(parts).toEqual([
            { type: "reasoning", text: "let me think" },
            { type: "text", text: "the answer" },
        ]);
    });

    test("text resumed after a tool call becomes a new part, not an extension", () => {
        const parts = fold([
            { type: "text-delta", text: "checking" },
            { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} },
            { type: "text-delta", text: "found it" },
        ]);

        expect(parts).toEqual([
            { type: "text", text: "checking" },
            { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} },
            { type: "text", text: "found it" },
        ]);
    });
});

describe("tool calls", () => {
    test("a result merges into its call rather than appending a part", () => {
        const parts = fold([
            { type: "tool-call", toolCallId: "c1", toolName: "ls", args: { path: "." } },
            { type: "tool-result", toolCallId: "c1", result: "src/" },
        ]);

        expect(parts).toEqual([
            { type: "tool-call", toolCallId: "c1", toolName: "ls", args: { path: "." }, result: "src/" },
        ]);
    });

    test("results land on the matching call when several are in flight", () => {
        const parts = fold([
            { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} },
            { type: "tool-call", toolCallId: "c2", toolName: "cat", args: {} },
            { type: "tool-result", toolCallId: "c2", result: "contents" },
        ]);

        expect(parts).toEqual([
            { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} },
            { type: "tool-call", toolCallId: "c2", toolName: "cat", args: {}, result: "contents" },
        ]);
    });

    test("a result for an unknown call is ignored rather than inventing a part", () => {
        const parts = fold([
            { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} },
            { type: "tool-result", toolCallId: "nope", result: "orphan" },
        ]);

        expect(parts).toEqual([{ type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} }]);
    });
});

describe("tool approval", () => {
    test("an approval request marks the matching call pending, not appends a part", () => {
        const parts = fold([
            { type: "tool-call", toolCallId: "c1", toolName: "bash", args: { command: "rm -rf /" } },
            { type: "tool-approval-request", toolCallId: "c1", approvalId: "appr-1" },
        ]);

        expect(parts).toEqual([
            {
                type: "tool-call",
                toolCallId: "c1",
                toolName: "bash",
                args: { command: "rm -rf /" },
                approvalId: "appr-1",
                approvalStatus: "pending",
            },
        ]);
    });

    test("a later tool-result still merges onto the same part, leaving approval fields intact", () => {
        const parts = fold([
            { type: "tool-call", toolCallId: "c1", toolName: "bash", args: {} },
            { type: "tool-approval-request", toolCallId: "c1", approvalId: "appr-1" },
            { type: "tool-result", toolCallId: "c1", result: "done" },
        ]);

        expect(parts).toEqual([
            {
                type: "tool-call",
                toolCallId: "c1",
                toolName: "bash",
                args: {},
                approvalId: "appr-1",
                approvalStatus: "pending",
                result: "done",
            },
        ]);
    });
});

describe("lifecycle events", () => {
    test("start, done and error contribute no parts", () => {
        const parts = fold([
            { type: "start", messageId: "m1" },
            { type: "text-delta", text: "hi" },
            { type: "done", durationMs: 12 },
            { type: "error", code: "provider_error", message: "boom" },
        ]);

        expect(parts).toEqual([{ type: "text", text: "hi" }]);
    });

    test("a lifecycle event returns the same contents it was given", () => {
        const before: MessagePart[] = [{ type: "text", text: "hi" }];
        expect(applyStreamEvent(before, { type: "done", durationMs: 1 })).toEqual(before);
    });
});

describe("immutability", () => {
    test("the input array is never mutated", () => {
        const before: MessagePart[] = [{ type: "text", text: "hi" }];
        const after = applyStreamEvent(before, { type: "text-delta", text: " there" });

        expect(before).toEqual([{ type: "text", text: "hi" }]);
        expect(after).not.toBe(before);
    });

    test("the extended part is replaced, not edited in place", () => {
        const original: MessagePart = { type: "text", text: "hi" };
        const after = applyStreamEvent([original], { type: "text-delta", text: "!" });

        expect(original).toEqual({ type: "text", text: "hi" });
        expect(after[0]).not.toBe(original);
    });

    test("a merged tool result does not mutate the original call part", () => {
        const original: MessagePart = { type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} };
        applyStreamEvent([original], { type: "tool-result", toolCallId: "c1", result: "src/" });

        expect(original).toEqual({ type: "tool-call", toolCallId: "c1", toolName: "ls", args: {} });
    });
});

describe("output validity", () => {
    test("a realistic interleaved stream folds into schema-valid parts", () => {
        const parts = fold([
            { type: "start", messageId: "m1" },
            { type: "reasoning-delta", text: "need to look" },
            { type: "tool-call", toolCallId: "c1", toolName: "read_file", args: { path: "a.ts" } },
            { type: "tool-result", toolCallId: "c1", result: "export {}" },
            { type: "text-delta", text: "The file " },
            { type: "text-delta", text: "is empty." },
            { type: "done", durationMs: 900 },
        ]);

        expect(messagePartsSchema.safeParse(parts).success).toBe(true);
        expect(parts).toHaveLength(3);
    });
});
