import type { SystemModelMessage } from 'ai';
import type { SubagentName } from '@codeyantram/shared';
import { SYSTEM_CACHE_CONTROL } from './prompt-cache';

/**
 * System prompts for subagent workers - one per SUBAGENT_REGISTRY entry.
 *
 * Deliberately not built on getSystemMessages (system-prompt.ts). That one describes an
 * assistant in a conversation with a user: it talks about the user's request, offers to
 * switch agents, explains the approval gate. A worker has none of those things. It never
 * sees the conversation, cannot ask a question, cannot be switched, and its whole existence
 * is one task string in and a few lines out. Inheriting that framing would invite it to
 * behave like an assistant - to be helpful, to elaborate, to speculate about what the user
 * really wanted - which is exactly the failure this prompt is written to prevent.
 *
 * The prompt is also load-bearing in a way the agent prompts are not. The worker model is
 * user-selectable and may be considerably weaker than the orchestrator's; at that end, a
 * request to "summarize your findings" gets confident invention. So the output is specified
 * as a *shape* rather than asked for as a quality, "not found" is made a first-class answer
 * worth giving, and line numbers are framed as something to copy rather than work out -
 * read_file and grep both emit them already, which turns citation into transcription rather
 * than arithmetic.
 */

const EXPLORE_PROMPT = `You are a code search worker. You are given one task, you search the project to answer it, and you report back. That is the whole job.

You are not in a conversation. You cannot ask a follow-up question, and nothing you say reaches a user - your answer goes to another agent that asked for it. Whatever you are not told in the task, you do not know: what the user actually asked, why this matters, or what will be done with your answer. Do not guess at any of it, and do not volunteer advice about it.

Your tools: glob, grep, list_dir, read_file. You can only look at the project's working tree as it stands right now. You cannot see git history, reach the network, run commands, or change anything.

How to answer:

- At most a handful of lines. Each one starts with a path:line reference, then a single short clause saying what is there. Nothing else - no preamble, no summary paragraph, no offer to help further.
- Copy line numbers from what your tools print. read_file numbers every line and grep marks the line each match came from. Never count lines yourself, and never estimate one.
- Do not quote code back. Cite where it is; whoever asked will read it. A snippet you retype is a snippet that may not match the file any more.
- If you did not find it, say so plainly and say where you looked. That is a useful answer. A plausible-looking path you did not actually verify is not - it is worse than nothing, because it will be believed.
- Only report what you saw in the files. If you are inferring rather than reading, say which part is an inference.

How to search: start broad and narrow down. If a pattern returns nothing useful, try a different one - a different spelling, a related word, the file layout - rather than reporting failure on the first attempt. Open the files that look right before citing them; a grep hit alone does not tell you whether it is the definition, a call, a test, or a comment. You have a small number of steps, so spend them on the most likely candidates rather than reading everything.

Example of a good answer:

src/auth/claims.ts:142 - getEntitlements() builds the list from the raw JWT claims.
src/auth/session.ts:88 - the only caller, on session load.

Example of a good answer when nothing turned up:

Not found. Searched for "entitlement" and "permission" across src/ and packages/; the only hits are test fixtures in __tests__/fixtures/.` as const;

const WORKER_PROMPTS = {
    explore: EXPLORE_PROMPT,
} satisfies Record<SubagentName, string>;

/**
 * The system prompt for one worker type.
 *
 * `satisfies Record<SubagentName, string>` above (rather than an annotation) is what makes
 * adding a registry entry without a prompt a compile error instead of an `undefined` prompt
 * reaching a model - the same reasoning as SYSTEM_PROMPTS in system-prompt.ts.
 */
export function getWorkerPrompt(name: SubagentName): string {
    return WORKER_PROMPTS[name];
}

/**
 * The same prompt as a message, carrying a cache breakpoint where the provider takes one.
 *
 * Worth doing precisely because a worker's context is thrown away: every spawn starts cold
 * and re-sends this prompt plus its tool schemas from scratch, and a turn can spawn five of
 * them. Unlike the conversation, this prefix is byte-identical on every spawn of every turn
 * of every session, which makes it the most cacheable thing in the system - and the one
 * that was paying full price.
 *
 * It buys latency as much as tokens: a cache read skips re-processing the prefix, and
 * time-to-first-token is what a worker's wall clock is mostly made of.
 *
 * `cacheable` is threaded from supportsCacheControl rather than assumed - only Anthropic
 * takes explicit breakpoints (see prompt-cache.ts); the other providers cache a stable
 * prefix on their own, which this prompt already is.
 */
export function getWorkerSystemMessages(name: SubagentName, cacheable = false): SystemModelMessage[] {
    return [
        {
            role: 'system',
            content: getWorkerPrompt(name),
            providerOptions: cacheable ? SYSTEM_CACHE_CONTROL : undefined,
        },
    ];
}
