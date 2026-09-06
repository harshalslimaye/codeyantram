import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { ModelMessage } from 'ai';
import type { SupportedProvider } from '@codeyantram/shared';

// Anthropic's cache_control breakpoints, attached per-message (never at the top-level
// streamText providerOptions) - an unrecognized providerOptions namespace is harmless to
// another provider's SDK, but there's no reason to send it where it means nothing.
//
// The two differ only in TTL, and deliberately:
//
// The system prefix (tools + agent prompt + AGENTS.md, ~6K tokens measured) is re-sent
// byte-identical on every step of every turn, so it clears the 1-hour break-even of three
// requests immediately - and it is the half worth protecting across a gap, since a user
// who reads a diff for ten minutes before replying would otherwise pay to rebuild all of
// it. A 1h write costs 2x base against 1.25x for 5m.
//
// The conversation keeps the 5-minute default. A cache read refreshes the entry's timer at
// no cost, so an active session keeps it warm indefinitely without the doubled write - and
// the conversation is exactly the part that changes every turn, so paying the 1h premium
// on bytes that a later turn extends anyway would be buying retention for a prefix that is
// about to be superseded.
//
// Order matters: the API requires longer-TTL entries to appear before shorter ones, and
// the system prompt always renders before the messages, so this pairing is the only legal
// one of the two.
export const SYSTEM_CACHE_CONTROL: ProviderOptions = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } };
export const CONVERSATION_CACHE_CONTROL: ProviderOptions = { anthropic: { cacheControl: { type: 'ephemeral' } } };

/**
 * Whether this provider takes explicit cache breakpoints at all.
 *
 * Anthropic is the only one: OpenAI caches any prefix over its own minimum automatically,
 * Google caches implicitly on current Gemini models, and DeepSeek's context cache isn't
 * configurable. For those three the work is *not breaking the prefix* (deterministic tool
 * order, nothing per-request ahead of the conversation), which costs no code here.
 *
 * Measured 2026-09-06, three turns each through the real /chat route:
 * - Anthropic (claude-sonnet-5) read 7,888 of turn 2's 7,921 input tokens, writing only
 *   the 31-token delta - and 0 of turn 1's, since the phase that set the system blocks to
 *   a 1h TTL re-keyed the prefix.
 * - DeepSeek (deepseek-v4-flash) read 5,248 of turn 2's 5,281 with no markers sent at all,
 *   and reports no write count because it charges no write premium. Its read is rounded
 *   down to its own block granularity, so a turn that adds a few tokens can report the
 *   same figure as the one before it - not a miss.
 * - OpenAI and Google were unreachable: no keys configured on this machine. Their
 *   automatic caching is documented behavior here, not something this repo has measured.
 */
export function supportsCacheControl(provider: SupportedProvider): boolean {
    return provider === 'anthropic';
}

// Part types the Anthropic converter never renders as a content block: approval requests
// and responses are an AI SDK bookkeeping construct, not something the API sees. A
// breakpoint on a message made only of these is silently dropped - no error, just a cache
// miss - which is exactly the shape of an approval round trip (see toolPartsToMessages),
// the request that most needs the cache to land.
const NON_RENDERING_PART_TYPES: readonly string[] = ['tool-approval-request', 'tool-approval-response'];

/**
 * How far back from the tail the second breakpoint sits, in rendered positions.
 *
 * Anthropic's breakpoint lookback is 20 positions: a marker walks backward at most that
 * far looking for a live cache entry, and finds nothing beyond it - so a turn that appends
 * more than 20 positions (a long sequential tool loop; this server allows 15 steps, each
 * costing a tool_use and a tool_result position) pushes the previous request's entry out
 * of the window, and every request silently rewrites the whole conversation with
 * byte-identical bytes. Anchoring the second marker 15 positions back keeps the tail
 * marker's own lookback inside the window no matter how long the turn ran, with headroom
 * against the position-counting approximation below.
 */
const LOOKBACK_MARGIN_POSITIONS = 15;

/**
 * The message's provider options with our own breakpoint removed, and nothing else
 * touched - other anthropic options and other providers' namespaces survive. Needed
 * because withConversationCache re-runs over messages it has already marked (see
 * rollConversationCache): a marker left behind on a message that is no longer an anchor
 * would eat one of the four breakpoint slots, and the provider drops whichever ones
 * overflow with only a warning.
 */
function withoutCacheControl(providerOptions: ProviderOptions | undefined): ProviderOptions | undefined {
    if (providerOptions?.anthropic?.cacheControl === undefined) return providerOptions;

    const { cacheControl: _removed, ...anthropic } = providerOptions.anthropic;
    const { anthropic: _replaced, ...others } = providerOptions;

    const next = Object.keys(anthropic).length > 0 ? { ...others, anthropic } : others;
    return Object.keys(next).length > 0 ? next : undefined;
}

/** Whether a breakpoint placed on this message would actually reach the provider. */
function rendersCacheableBlock(message: ModelMessage): boolean {
    // Never an anchor: the system prompt is cached by getSystemMessages, on its own
    // breakpoints, at its own TTL.
    if (message.role === 'system') return false;

    const { content } = message;

    // A cancelled turn that produced no deltas round-trips as an empty assistant
    // message; there is no block for a marker to attach to.
    if (typeof content === 'string') return content.trim() !== '';

    // The array's member type differs per role (tool messages carry results, assistant
    // messages carry text/tool calls), so widen to the one field this cares about rather
    // than narrowing the union four ways.
    return (content as readonly { type: string }[]).some(part => !NON_RENDERING_PART_TYPES.includes(part.type));
}

/**
 * Marks the conversation's cache breakpoints, so the next request reads this one back from
 * cache instead of re-paying for it. Without them only the system prefix is cached (see
 * getSystemMessages) and every tool result is billed in full on every step of every turn -
 * including each approval round trip, which replays the entire history as a fresh request.
 *
 * Two markers, which is exactly the budget: Anthropic allows four per request and the
 * system prompt already spends two. The tail marker extends the cached prefix over
 * whatever this turn added; the second sits LOOKBACK_MARGIN_POSITIONS back so the tail's
 * lookback always lands on a live entry, and is omitted entirely on a conversation too
 * short for that to be in question.
 *
 * Anchors are messages that render a cacheable block, not simply the last messages (see
 * rendersCacheableBlock). Returns the input untouched for a provider that doesn't take
 * breakpoints, and never mutates the array it is given.
 */
export function withConversationCache(messages: ModelMessage[], provider: SupportedProvider): ModelMessage[] {
    if (!supportsCacheControl(provider)) return messages;

    // One position per rendering message. The converter collapses a run of consecutive
    // tool_use (or tool_result) blocks into a single position, so this over-counts
    // wherever that happens - which places the second marker nearer than
    // LOOKBACK_MARGIN_POSITIONS rather than further, the safe direction to be wrong in.
    const anchors = messages.flatMap((message, index) => (rendersCacheableBlock(message) ? [index] : []));

    const tail = anchors.at(-1);
    if (tail === undefined) return messages;

    const lookback = anchors.length > LOOKBACK_MARGIN_POSITIONS ? anchors.at(-1 - LOOKBACK_MARGIN_POSITIONS) : undefined;
    const marked = new Set(lookback === undefined ? [tail] : [lookback, tail]);

    return messages.map((current, index) => {
        // The system prompt carries its own two breakpoints (see getSystemMessages) and is
        // handed to the provider separately from the conversation - but streamText can
        // also carry system messages inside `messages`, and stripping one there would
        // silently drop a system breakpoint instead of moving a conversation one.
        if (current.role === 'system') return current;

        // Cleared first so re-running over an already-marked array moves the breakpoints
        // rather than accumulating them.
        const providerOptions = withoutCacheControl(current.providerOptions);

        if (!marked.has(index)) {
            return providerOptions === current.providerOptions ? current : ({ ...current, providerOptions } as ModelMessage);
        }

        // Merged one level down, not at the top: spreading the constant wholesale would
        // replace the anthropic namespace and take any other option on that message with
        // it. Other providers' namespaces and other anthropic options both survive; only
        // the breakpoint itself is set.
        return {
            ...current,
            providerOptions: {
                ...providerOptions,
                anthropic: { ...providerOptions?.anthropic, ...CONVERSATION_CACHE_CONTROL.anthropic },
            },
        } as ModelMessage;
    });
}

/**
 * The same placement, re-run between the steps of one turn - streamText's `prepareStep`
 * hook, in the shape it expects (`undefined` means "change nothing about this step").
 *
 * The call-site placement only covers the messages a request *arrives* with. A turn that
 * runs ten tool steps appends ten tool calls and ten results before it finishes, and every
 * one of those steps re-sends everything the earlier steps produced - at full price, since
 * the breakpoints are still sitting back at the request's original tail. Re-anchoring each
 * step lets the cache accrue within the turn as well as across turns; the override carries
 * forward, which is why withConversationCache has to clear stale markers.
 */
export function rollConversationCache(
    messages: ModelMessage[],
    provider: SupportedProvider,
): { messages: ModelMessage[] } | undefined {
    const cached = withConversationCache(messages, provider);

    // Identity means nothing moved - a provider without explicit breakpoints - so leave
    // the step untouched rather than handing back a no-op override.
    return cached === messages ? undefined : { messages: cached };
}
