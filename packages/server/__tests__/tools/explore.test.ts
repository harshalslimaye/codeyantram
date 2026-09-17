import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import {
    DEFAULT_WORKER_MODEL_ID,
    PROVIDER_ENV_VARS,
    SUBAGENT_REGISTRY,
    SUPPORTED_PROVIDERS,
    isSubagentTool,
} from '@codeyantram/shared';
import { runSubagent, runWorkerLoop } from '../../src/tools/explore';
import { createTurnToolAccounting, type TurnToolAccounting } from '../../src/tools';
import { MAX_SUBAGENT_OUTPUT_CHARS, MAX_SUBAGENT_SPAWNS_PER_TURN, MAX_SUBAGENT_STEPS } from '../../src/tools/shared';

let projectDir: string;

beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'codeyantram-explore-'));
});

afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
});

/** Provider-level usage, which is nested per LanguageModelV4Usage - the flat
 * inputTokens/outputTokens numbers the AI SDK reports back are normalized from this. */
function usage(input: number, output: number) {
    return {
        inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: output, text: output, reasoning: undefined },
    };
}

/** Provider-level finish reason, which is an object pairing the unified reason with the
 * provider's own raw one. */
function finish(unified: 'stop' | 'tool-calls') {
    return { unified, raw: unified };
}

/** A worker model that answers once, with text and no tool calls - the shortest possible
 * successful run. */
function answering(text: string, tokens = usage(1000, 50)) {
    return new MockLanguageModelV4({
        doGenerate: async () => ({
            content: text === '' ? [] : [{ type: 'text' as const, text }],
            finishReason: finish('stop'),
            usage: tokens,
            warnings: [],
        }),
    });
}

describe('runWorkerLoop', () => {
    test('returns the worker\'s final text', async () => {
        const answer = 'src/auth/claims.ts:142 - getEntitlements() builds the list.';
        const result = await runWorkerLoop({
            name: 'explore',
            task: 'Find where entitlements are assembled',
            cwd: projectDir,
            languageModel: answering(answer),
        });

        expect(result).toBe(answer);
    });

    // The cap is enforced here rather than requested in the prompt, because a prompt-only
    // limit is a request and a small worker model will exceed it - at which point the raw
    // output this whole mechanism exists to keep out flows into the orchestrator's context.
    test('truncates an over-long answer at the output cap', async () => {
        const result = await runWorkerLoop({
            name: 'explore',
            task: 'Find where entitlements are assembled',
            cwd: projectDir,
            languageModel: answering('x'.repeat(MAX_SUBAGENT_OUTPUT_CHARS + 500)),
        });

        expect(result.length).toBeLessThan(MAX_SUBAGENT_OUTPUT_CHARS + 50);
        expect(result.endsWith('… truncated')).toBe(true);
    });

    test('leaves an answer at exactly the cap alone', async () => {
        const result = await runWorkerLoop({
            name: 'explore',
            task: 'Find where entitlements are assembled',
            cwd: projectDir,
            languageModel: answering('x'.repeat(MAX_SUBAGENT_OUTPUT_CHARS)),
        });

        expect(result).not.toContain('truncated');
    });

    // Distinct from an error (the run failed) and from "not found" (it looked and said so).
    test('reports a worker that finished without saying anything', async () => {
        const result = await runWorkerLoop({
            name: 'explore',
            task: 'Find where entitlements are assembled',
            cwd: projectDir,
            languageModel: answering(''),
        });

        expect(result).toContain('without reporting anything');
    });

    test('accumulates worker token spend onto the turn', async () => {
        const accounting = createTurnToolAccounting();

        for (const _ of [0, 1]) {
            await runWorkerLoop({
                name: 'explore',
                task: 'Find where entitlements are assembled',
                cwd: projectDir,
                accounting,
                languageModel: answering('found it', usage(9000, 40)),
            });
        }

        expect(accounting.subagentInputTokens).toBe(18_000);
        expect(accounting.subagentOutputTokens).toBe(80);
    });

    // Worker steps must never be recorded as the orchestrator's tool output: they never
    // enter its context, and counting them there would wrongly attribute window occupancy
    // to a turn that only ever saw the summary.
    test('does not record the worker\'s own tool use as the turn\'s tool output', async () => {
        const accounting = createTurnToolAccounting();

        await runWorkerLoop({
            name: 'explore',
            task: 'Find where entitlements are assembled',
            cwd: projectDir,
            accounting,
            languageModel: answering('found it'),
        });

        expect([...accounting.perTool.keys()]).toEqual([]);
    });

    test('caps the worker loop at MAX_SUBAGENT_STEPS', async () => {
        let calls = 0;
        // Always answers with a tool call, so only stopWhen can end the loop.
        const looping = new MockLanguageModelV4({
            doGenerate: async () => {
                calls += 1;
                return {
                    content: [
                        {
                            type: 'tool-call' as const,
                            toolCallId: `call_${calls}`,
                            toolName: 'list_dir',
                            input: JSON.stringify({ path: '.' }),
                        },
                    ],
                    finishReason: finish('tool-calls'),
                    usage: usage(10, 5),
                    warnings: [],
                };
            },
        });

        await runWorkerLoop({
            name: 'explore',
            task: 'Find where entitlements are assembled',
            cwd: projectDir,
            languageModel: looping,
        });

        expect(calls).toBe(MAX_SUBAGENT_STEPS);
    });

    // Without this, pressing Esc leaves the worker loop running - and billing - after the
    // user has moved on. Asserted by checking the signal actually reaches the model call,
    // rather than by aborting first: a mock that resolves immediately never gets far enough
    // to observe cancellation, so that test would pass whether or not the signal was wired.
    test('passes the turn\'s abort signal down to the worker\'s model call', async () => {
        const controller = new AbortController();
        let seen: AbortSignal | undefined;

        const recording = new MockLanguageModelV4({
            doGenerate: async ({ abortSignal }) => {
                seen = abortSignal;
                return {
                    content: [{ type: 'text' as const, text: 'done' }],
                    finishReason: finish('stop'),
                    usage: usage(1, 1),
                    warnings: [],
                };
            },
        });

        await runWorkerLoop({
            name: 'explore',
            task: 'Find where entitlements are assembled',
            cwd: projectDir,
            languageModel: recording,
            abortSignal: controller.signal,
        });

        expect(seen).toBe(controller.signal);
    });

    test('a real abort mid-worker rejects rather than returning a partial answer', async () => {
        const controller = new AbortController();

        const slow = new MockLanguageModelV4({
            doGenerate: async ({ abortSignal }) => {
                controller.abort();
                abortSignal?.throwIfAborted();
                return {
                    content: [{ type: 'text' as const, text: 'should never be reached' }],
                    finishReason: finish('stop'),
                    usage: usage(1, 1),
                    warnings: [],
                };
            },
        });

        await expect(
            runWorkerLoop({
                name: 'explore',
                task: 'Find where entitlements are assembled',
                cwd: projectDir,
                languageModel: slow,
                abortSignal: controller.signal,
            }),
        ).rejects.toThrow();
    });

    test('gives the worker exactly its registry toolset, and nothing that could spawn another', async () => {
        let toolNames: string[] = [];
        const inspecting = new MockLanguageModelV4({
            doGenerate: async ({ tools }) => {
                toolNames = (tools ?? []).map(tool => tool.name);
                return {
                    content: [{ type: 'text' as const, text: 'done' }],
                    finishReason: finish('stop'),
                    usage: usage(1, 1),
                    warnings: [],
                };
            },
        });

        await runWorkerLoop({
            name: 'explore',
            task: 'Find where entitlements are assembled',
            cwd: projectDir,
            languageModel: inspecting,
        });

        expect(toolNames.sort()).toEqual([...SUBAGENT_REGISTRY.explore.tools].sort());
        expect(toolNames.some(isSubagentTool)).toBe(false);
        expect(toolNames).not.toContain('bash');
        expect(toolNames).not.toContain('edit_file');
        expect(toolNames).not.toContain('web_fetch');
    });
});

describe('worker latency settings', () => {
    // A worker's steps are what a turn waits on, and an unset effort level used to mean
    // "the provider's default" - which for DeepSeek is "high". A worker greps, looks and
    // cites; deep reasoning buys nothing there and costs seconds per spawn.
    test('an unset worker effort resolves to the model\'s lowest, not the provider default', async () => {
        const { resolveWorkerModel } = await import('../../src/lib/models');
        const previous = process.env[PROVIDER_ENV_VARS.deepseek];
        process.env[PROVIDER_ENV_VARS.deepseek] = 'test-key';

        try {
            const resolved = await resolveWorkerModel({
                requested: 'deepseek-v4-pro',
                orchestratorModelId: 'deepseek-v4-pro',
            });

            // deepseek-v4-pro's own defaultEffortLevel is "high"; "none" is the lowest it
            // accepts, and it disables thinking outright.
            expect(resolved.providerOptions).toEqual({ deepseek: { thinking: { type: 'disabled' } } });
        } finally {
            if (previous === undefined) delete process.env[PROVIDER_ENV_VARS.deepseek];
            else process.env[PROVIDER_ENV_VARS.deepseek] = previous;
        }
    });

    test('an explicit worker effort still wins', async () => {
        const { resolveWorkerModel } = await import('../../src/lib/models');
        const previous = process.env[PROVIDER_ENV_VARS.deepseek];
        process.env[PROVIDER_ENV_VARS.deepseek] = 'test-key';

        try {
            const resolved = await resolveWorkerModel({
                requested: 'deepseek-v4-pro',
                effort: 'high',
                orchestratorModelId: 'deepseek-v4-pro',
            });

            expect(resolved.providerOptions).toEqual({ deepseek: { reasoningEffort: 'high' } });
        } finally {
            if (previous === undefined) delete process.env[PROVIDER_ENV_VARS.deepseek];
            else process.env[PROVIDER_ENV_VARS.deepseek] = previous;
        }
    });

    // Byte-identical on every spawn of every turn, so it is the most cacheable prefix in
    // the system - and it was paying full price on each of a turn's five workers.
    test('attaches a cache breakpoint to the worker prompt where the provider takes one', async () => {
        let seenSystem: unknown;
        const recording = new MockLanguageModelV4({
            doGenerate: async ({ prompt }) => {
                seenSystem = prompt.find(message => message.role === 'system');
                return {
                    content: [{ type: 'text' as const, text: 'done' }],
                    finishReason: finish('stop'),
                    usage: usage(1, 1),
                    warnings: [],
                };
            },
        });

        await runWorkerLoop({
            name: 'explore',
            task: 'Find where entitlements are assembled',
            cwd: projectDir,
            languageModel: recording,
            cacheable: true,
        });

        expect((seenSystem as any)?.providerOptions).toBeDefined();
    });
});

describe('runSubagent spawn budget', () => {
    function atSpawns(count: number): TurnToolAccounting {
        return { ...createTurnToolAccounting(), subagentSpawns: count };
    }

    test('refuses once the turn has spent its budget, without resolving a model', async () => {
        const accounting = atSpawns(MAX_SUBAGENT_SPAWNS_PER_TURN);

        // No workerModel at all: if the budget check did not come first, this would fall
        // through to the model-resolution path instead of refusing.
        const result = await runSubagent('explore', 'Find the approval gate', projectDir, { accounting });

        expect(result).toContain('budget for this turn is exhausted');
        expect(accounting.subagentSpawns).toBe(MAX_SUBAGENT_SPAWNS_PER_TURN);
    });

    test('is a plain instruction, not an error - the turn is fine, delegation just ran out', async () => {
        const result = await runSubagent('explore', 'Find the approval gate', projectDir, {
            accounting: atSpawns(MAX_SUBAGENT_SPAWNS_PER_TURN),
        });

        expect(result.startsWith('Error')).toBe(false);
        expect(result).toContain('yourself');
    });

    test('still allows the last spawn inside the budget', async () => {
        const accounting = atSpawns(MAX_SUBAGENT_SPAWNS_PER_TURN - 1);
        const result = await runSubagent('explore', 'Find the approval gate', projectDir, { accounting });

        expect(result).not.toContain('budget for this turn is exhausted');
    });

    // The counter lives on the per-turn accounting record, so a new turn starts over - the
    // budget bounds one user message, not a session.
    test('a fresh turn starts with a full budget', () => {
        expect(createTurnToolAccounting().subagentSpawns).toBe(0);
    });
});

describe('worker model resolution', () => {
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const provider of SUPPORTED_PROVIDERS) {
            const envVar = PROVIDER_ENV_VARS[provider];
            originalEnv[envVar] = process.env[envVar];
            delete process.env[envVar];
        }
    });

    afterEach(() => {
        for (const [envVar, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[envVar];
            else process.env[envVar] = value;
        }
    });

    async function resolve(choice: Parameters<typeof import('../../src/lib/models').resolveWorkerModel>[0]) {
        const { resolveWorkerModel } = await import('../../src/lib/models');
        return resolveWorkerModel(choice);
    }

    test('uses the model the user picked', async () => {
        process.env[PROVIDER_ENV_VARS.google] = 'test-key';

        const resolved = await resolve({ requested: 'gemini-3.5-flash', orchestratorModelId: 'claude-opus-5' });

        expect(resolved.model.id).toBe('gemini-3.5-flash');
    });

    test('falls back to the default when the user picked nothing', async () => {
        process.env[PROVIDER_ENV_VARS.anthropic] = 'test-key';

        const resolved = await resolve({ orchestratorModelId: 'claude-opus-5' });

        expect(resolved.model.id).toBe(DEFAULT_WORKER_MODEL_ID);
    });

    // The worker's provider is chosen independently of the orchestrator's, so a user with
    // only one key configured would otherwise hit MissingCredentialsError mid-turn, inside
    // a tool call, where there is no approval prompt and no good error path.
    test('falls back to the orchestrator\'s model when the worker\'s provider has no key', async () => {
        process.env[PROVIDER_ENV_VARS.google] = 'test-key';

        const resolved = await resolve({ requested: 'claude-opus-5', orchestratorModelId: 'gemini-3.5-flash' });

        expect(resolved.model.id).toBe('gemini-3.5-flash');
    });

    test('falls back for an id no catalog knows about', async () => {
        process.env[PROVIDER_ENV_VARS.anthropic] = 'test-key';

        const resolved = await resolve({ requested: 'retired-model-9', orchestratorModelId: 'claude-opus-5' });

        expect(resolved.model.id).toBe('claude-opus-5');
    });

    test('a worker may be on a different provider than the orchestrator', async () => {
        process.env[PROVIDER_ENV_VARS.anthropic] = 'test-key';
        process.env[PROVIDER_ENV_VARS.google] = 'test-key';

        const resolved = await resolve({ requested: 'gemini-3.5-flash', orchestratorModelId: 'claude-opus-5' });

        expect(resolved.model.provider).toBe('google');
    });

    // Nothing left to fall back to: re-trying the orchestrator's own model would fail
    // identically, so the error belongs to the caller.
    test('throws when neither the worker nor the orchestrator model can resolve', async () => {
        await expect(resolve({ requested: 'claude-opus-5', orchestratorModelId: 'gemini-3.5-flash' })).rejects.toThrow();
    });

    test('does not carry the worker\'s effort over to the fallback model', async () => {
        process.env[PROVIDER_ENV_VARS.google] = 'test-key';

        // "max" is Anthropic-only; Gemini tops out at "high". Carrying it across would
        // either throw or send a level the provider rejects.
        const resolved = await resolve({
            requested: 'claude-opus-5',
            effort: 'max',
            orchestratorModelId: 'gemini-3.5-flash',
        });

        expect(resolved.model.id).toBe('gemini-3.5-flash');
        expect(resolved.providerOptions).toBeUndefined();
    });
});
