import type { ChatStreamEvent, MessagePart } from "./schemas";

/**
 * Extends the trailing part when it is the same kind of delta, otherwise
 * starts a new one. This is what makes an interleaved response
 * (reasoning -> text -> tool call -> more text) reconstruct into four parts
 * instead of collapsing into two.
 */
function appendDelta(
    parts: MessagePart[],
    type: "text" | "reasoning",
    text: string,
): MessagePart[] {
    const last = parts.at(-1);

    if (last !== undefined && (last.type === "text" || last.type === "reasoning") && last.type === type) {
        return [...parts.slice(0, -1), { type: last.type, text: last.text + text }];
    }

    return [...parts, { type, text }];
}

/**
 * Folds one stream event into the parts accumulated so far.
 *
 * Deltas arrive with no part boundaries of their own, so the rule for turning
 * them back into discrete parts lives here - shared rather than reimplemented
 * in the CLI, so the reconstruction is defined and tested in exactly one place.
 *
 * Always returns a new array and never mutates its input, so it can drive
 * React state directly. Lifecycle events (start/done/error) contribute no
 * parts and pass the array through untouched; the caller handles those.
 */
export function applyStreamEvent(parts: MessagePart[], event: ChatStreamEvent): MessagePart[] {
    switch (event.type) {
        case "text-delta":
            return appendDelta(parts, "text", event.text);

        case "reasoning-delta":
            return appendDelta(parts, "reasoning", event.text);

        case "tool-call":
            return [
                ...parts,
                {
                    type: "tool-call",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    args: event.args,
                },
            ];

        // Merged into the call it belongs to rather than appended, so a
        // finished call and its output render as one unit. An id with no
        // matching call is left alone rather than inventing a part for it.
        case "tool-result":
            return parts.map(part =>
                part.type === "tool-call" && part.toolCallId === event.toolCallId
                    ? { ...part, result: event.result }
                    : part,
            );

        // Also merged into the call it belongs to, marking it pending until
        // the CLI resolves the approval (see ChatProvider.respondToApproval).
        case "tool-approval-request":
            return parts.map(part =>
                part.type === "tool-call" && part.toolCallId === event.toolCallId
                    ? { ...part, approvalId: event.approvalId, approvalStatus: "pending" as const }
                    : part,
            );

        case "start":
        case "done":
        case "error":
            return parts;
    }
}
