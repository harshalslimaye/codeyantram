import { generateText, stepCountIs, type LanguageModel } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { SUBAGENT_REGISTRY, type SubagentName } from '@codeyantram/shared';
import { resolveWorkerModel } from '../lib/models';
import { getWorkerSystemMessages } from '../lib/worker-prompt';
import { supportsCacheControl } from '../lib/prompt-cache';
import { buildProjectTools, type ToolExecutorContext, type TurnToolAccounting } from './index';
import { MAX_SUBAGENT_OUTPUT_CHARS, MAX_SUBAGENT_SPAWNS_PER_TURN, MAX_SUBAGENT_STEPS } from './shared';

/** What the orchestrator reads when the turn has spent its spawn budget. Phrased as an
 * instruction rather than an error, because it is one: the turn is fine, there is just no
 * more delegation available, and the orchestrator should carry on with its own tools. */
const BUDGET_EXHAUSTED =
    'Exploration budget for this turn is exhausted - no more workers can be spawned. ' +
    'Answer from what you already have, or search and read the files yourself.';

/** What a worker that produced no text at all comes back as. Distinct from an error (the
 * run failed) and from "not found" (the worker looked and reported nothing there): this is
 * the worker finishing without saying anything, which a small model does occasionally. */
const NO_ANSWER =
    'The worker finished without reporting anything. Try a narrower task, or search directly.';

/**
 * Runs one subagent worker to completion and returns its final text.
 *
 * This is the whole subagent mechanism, and the thing that makes it work is what *doesn't*
 * happen here: generateText, not streamText, and nothing emitted to the SSE stream. The
 * worker's own tool calls and their results - the hundred grep hits, the five hundred lines
 * read - live and die inside this function. Only the returned string crosses back, so only
 * the returned string enters the orchestrator's context and gets replayed on every later
 * request. Streaming the worker's steps out would put all of it back in the transcript and
 * make the entire exercise a no-op with extra latency.
 *
 * One level, no trees: the worker's toolset comes from SUBAGENT_REGISTRY, which never
 * contains a subagent tool, and it is built without a `workerModel`, so even a registry
 * mistake could not give it something to spawn.
 */
export async function runSubagent(
    name: SubagentName,
    task: string,
    cwd: string,
    context: ToolExecutorContext | undefined,
): Promise<string> {
    const { accounting, workerModel, abortSignal } = context ?? {};

    // Checked before anything costs anything - no model resolution, no tool construction.
    // A refusal should be free.
    if (accounting !== undefined && accounting.subagentSpawns >= MAX_SUBAGENT_SPAWNS_PER_TURN) {
        return BUDGET_EXHAUSTED;
    }

    // The orchestrator's model is the last-resort fallback when the worker's own provider
    // has no key (see resolveWorkerModel). Without a choice at all there is nothing to fall
    // back to, which only happens if a worker somehow reached here - it has no workerModel
    // by construction - so refuse rather than silently running on the default.
    if (workerModel === undefined) {
        return 'Error: no worker model is available in this context.';
    }

    const resolved = await resolveWorkerModel(workerModel);

    // Counted once the spawn is real - after the budget check and after the model resolves,
    // so a refused or unresolvable call never consumes budget.
    if (accounting !== undefined) accounting.subagentSpawns += 1;

    return runWorkerLoop({
        name,
        task,
        cwd,
        languageModel: resolved.languageModel,
        providerOptions: resolved.providerOptions,
        // Every spawn re-sends this prompt cold, so where the provider takes a breakpoint
        // it is worth one - see getWorkerSystemMessages.
        cacheable: supportsCacheControl(resolved.model.provider),
        accounting,
        abortSignal,
    });
}

export type WorkerLoopOptions = {
    name: SubagentName;
    task: string;
    cwd: string;
    languageModel: LanguageModel;
    providerOptions?: ProviderOptions;
    accounting?: TurnToolAccounting;
    abortSignal?: AbortSignal;
    /** Attach a provider cache breakpoint to the worker's system prompt. */
    cacheable?: boolean;
};

/**
 * The worker loop itself, on an already-resolved model.
 *
 * Split from runSubagent above so the two concerns stay separable: that one decides
 * *whether* to spawn (budget, model resolution, counting), this one *runs* one. The split
 * is also what makes the loop testable against a mock model without a provider key, since
 * nothing here resolves anything.
 */
export async function runWorkerLoop({
    name,
    task,
    cwd,
    languageModel,
    providerOptions,
    accounting,
    abortSignal,
    cacheable = false,
}: WorkerLoopOptions): Promise<string> {
    const result = await generateText({
        model: languageModel,
        providerOptions,
        system: getWorkerSystemMessages(name, cacheable),
        prompt: task,
        tools: buildProjectTools({
            cwd,
            only: SUBAGENT_REGISTRY[name].tools,
            // The worker is answering a narrow mechanical question, not working on the
            // project: AGENTS.md is overhead in a context this short-lived, and read_file's
            // nested-instruction discovery would otherwise splice instruction files into
            // its reads - where they would be read as guidance, and could end up quoted
            // back in the summary.
            includeProjectInstructions: false,
            // Every tool here is read-only, so none of them would pause for approval
            // anyway. Passed explicitly because it must stay true: subagent tools cannot
            // use the approval gate at all (the SDK runs them unconditionally), so a
            // mutating tool in a worker toolset would execute with no prompt and no way to
            // add one.
            skipApproval: true,
        }),
        stopWhen: stepCountIs(MAX_SUBAGENT_STEPS),
        // The turn's own cancellation. Without this, pressing Esc leaves the worker loop
        // running - and billing - after the user has moved on.
        abortSignal,
    });

    if (accounting !== undefined) {
        accounting.subagentInputTokens += result.usage.inputTokens ?? 0;
        accounting.subagentOutputTokens += result.usage.outputTokens ?? 0;
    }

    const text = result.text.trim();
    if (text === '') return NO_ANSWER;

    // Enforced here rather than asked for in the prompt. A prompt-only limit is a request,
    // and the worker model may be small enough to ignore it - at which point the raw output
    // this whole mechanism exists to keep out would flow straight into the orchestrator's
    // context.
    return text.length > MAX_SUBAGENT_OUTPUT_CHARS
        ? `${text.slice(0, MAX_SUBAGENT_OUTPUT_CHARS)}\n… truncated`
        : text;
}

type ExploreInput = { task: string };

export async function execute(input: ExploreInput, cwd: string, context?: ToolExecutorContext): Promise<string> {
    return runSubagent('explore', input.task, cwd, context);
}
