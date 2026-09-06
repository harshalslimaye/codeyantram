import type { AssistantMessage, ChatMessage } from "./schemas";
import type { SupportedChatModel } from "./models";

export type ContextUsage = {
    /** The provider-reported size of the current request's prompt, in tokens - already
     * includes the system prompt, tool schemas, and every prior turn (see the comment on
     * this same figure in prompt-cache.ts). Not a sum across messages: `inputTokens` on
     * the latest turn already *is* the whole prefix. */
    usedTokens: number;
    /** The model's own input ceiling, in tokens. */
    contextWindow: number;
    /** usedTokens / contextWindow as a percentage, clamped to [0, 100] and left
     * unrounded - callers round for their own display (a footer wants a whole
     * number; a detail view may want more precision). */
    percent: number;
};

/**
 * The most recent assistant message that carries a usable `usage.inputTokens` reading,
 * scanning backward past anything that doesn't: a trailing user message (nothing sent
 * yet), an assistant message still streaming (no "done" event yet, so no usage), or one
 * whose provider omitted the field entirely (every field in tokenUsageSchema is optional).
 * Returns null when no such message exists.
 *
 * Exposed on its own (contextUsage below is one consumer) because a caller wanting the
 * full picture - output tokens, cache activity, which turn's AGENTS.md rode along - needs
 * the whole message, not just the one number contextUsage boils it down to.
 */
export function latestUsageMessage(messages: readonly ChatMessage[]): AssistantMessage | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]!;
        if (message.role !== "assistant") continue;
        if (message.usage?.inputTokens === undefined) continue;
        return message;
    }

    return null;
}

/**
 * How full the context window is, going only by what the provider has actually reported -
 * never estimated or summed. Built on latestUsageMessage above: its inputTokens already
 * includes the system prompt, tool schemas and the whole conversation, so the latest
 * reading alone *is* the current prefix size - never a sum across messages.
 *
 * The reading is always one turn stale by construction: `inputTokens` only arrives on the
 * "done" event that closes a turn, so it describes the request that was just answered, not
 * the one about to be sent (see chat-stream.ts's streamChatResponse). A cancelled or
 * errored turn produces no "done" at all, so the previous reading is left in place rather
 * than cleared.
 */
export function contextUsage(messages: readonly ChatMessage[], model: SupportedChatModel): ContextUsage | null {
    const message = latestUsageMessage(messages);
    if (message === null) return null;

    const inputTokens = message.usage!.inputTokens!;
    const contextWindow = model.contextWindow;
    // Clamped rather than trusted: a stale capacity constant, or a provider counting
    // something (e.g. output) into the same figure, could otherwise report over 100%.
    const percent = contextWindow > 0 ? Math.min(100, Math.max(0, (inputTokens / contextWindow) * 100)) : 0;

    return { usedTokens: inputTokens, contextWindow, percent };
}
