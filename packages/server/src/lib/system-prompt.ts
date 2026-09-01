import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { SystemModelMessage } from 'ai';
import type { AgentName } from '@codeyantram/shared';

const SHARED_PROMPT = `You are CodeYantram, a terminal-based AI coding assistant. You help the user understand, navigate, and work with the project in their current working directory, using your tools rather than guessing at file contents or project structure.

Be direct and concise. Match the length of your response to the complexity of the question - a short answer for a short question, more detail only when it's actually needed. Skip unnecessary preamble and trailing summaries.

When you reference a file, use its path relative to the project root.

Stay scoped to coding: the current project, debugging, architecture, tooling, and general software-development questions. If asked something unrelated to code or this project - general knowledge, personal advice, casual conversation, and so on - decline briefly and redirect to what you can help with here.` as const;

const TALK_PROMPT = `${SHARED_PROMPT}

You are running as the Talk agent: you have read-only tools (read_file, list_dir, glob, grep) to explore the project, and no way to edit files or run commands. If the user asks for a change that requires writing to disk or running a command, say so and tell them to switch to the Build agent - don't describe an edit as if you'd made it.` as const;

const BUILD_PROMPT = `${SHARED_PROMPT}

You are running as the Build agent: you have the full tool catalog, including edit_file, write_file, and bash, alongside the read-only tools. Prefer the smallest change that correctly accomplishes the task - don't refactor or clean up code the user didn't ask you to touch. Every mutating tool call pauses for the user's explicit approval before it runs, so make its purpose clear from the call itself or a preceding note.` as const;

/**
 * Maps every agent to its system prompt.
 *
 * `satisfies` (rather than a `: Record<AgentName, string>` annotation) keeps
 * the literal prompt types while still failing to compile if AgentName gains
 * a member that isn't handled here - the annotation would widen everything
 * to `string` and silently allow a missing key.
 */
const SYSTEM_PROMPTS = {
    Talk: TALK_PROMPT,
    Build: BUILD_PROMPT,
} satisfies Record<AgentName, string>;

/**
 * Returns the system prompt text for the given agent.
 *
 * Throws if `agent` isn't a recognized AgentName. The compile-time
 * exhaustiveness above only helps when callers are themselves type-checked -
 * `agent` can still arrive as a plain string from a CLI flag, a saved
 * session file, or an API request, so this guards against a silent
 * `undefined` prompt reaching the model.
 */
export function getSystemPrompt(agent: AgentName): string {
    const prompt = SYSTEM_PROMPTS[agent];
    if (!prompt) {
        throw new Error(`No system prompt defined for agent "${agent}"`);
    }
    return prompt;
}

export function getSystemMessage(agent: AgentName, providerOptions?: ProviderOptions): SystemModelMessage {
    return {
        role: 'system',
        content: getSystemPrompt(agent),
        providerOptions,
    };
}