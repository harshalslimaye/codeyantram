import { tool, type ToolSet } from 'ai';
import { TOOL_CATALOG, isOrchestratorTool, isTalkTool, toolNeedsApproval, type SubagentUsage, type ToolName, type ToolUsage } from '@codeyantram/shared';
import { execute as bash } from './bash';
import { execute as editFile, undo as undoEdit } from './edit-file';
import { execute as git } from './git';
import { execute as glob } from './glob';
import { execute as grep } from './grep';
import { execute as listDir } from './list-dir';
import { execute as readFile } from './read-file';
import { execute as webFetch } from './web-fetch';
import { execute as writeFile } from './write-file';
import { execute as explore } from './explore';
import type { WorkerModelChoice } from '../lib/models';

/**
 * One tool's implementation. `input` is typed `any` here because each executor's real
 * parameter type already matches its own catalog entry's inputSchema and the shapes differ
 * per tool - the map cannot be narrower than their union.
 *
 * `context` carries what an executor may need beyond its own input and the project root.
 * Optional, and ignored by every executor that reads a file or runs a search: only the
 * subagent tool needs it, to pass the turn's cancellation down into a worker loop that can
 * run for fifteen seconds (every other tool finishes in milliseconds, so there has never
 * been anything to cancel).
 */
export type ToolExecutorContext = {
    /** The turn's own AbortSignal, as the AI SDK hands it to execute(). */
    abortSignal?: AbortSignal;
    /** Per-turn accounting, for a tool that spends tokens of its own. */
    accounting?: TurnToolAccounting;
    /** Which models a spawned worker may run on (see resolveWorkerModel). */
    workerModel?: WorkerModelChoice;
};

type ToolExecutor = (input: any, cwd: string, context?: ToolExecutorContext) => Promise<string>;

const TOOL_EXECUTORS: Record<ToolName, ToolExecutor> = {
    // Wrapped, not passed directly: read_file's own third parameter is a dedup set for
    // nested instruction files, not the executor context. buildProjectTools re-wraps it
    // below with that turn's set; this entry is what a caller building tools without one
    // gets.
    read_file: (input: any, cwd: string) => readFile(input, cwd),
    list_dir: listDir,
    glob,
    grep,
    edit_file: editFile,
    undo_edit: undoEdit,
    write_file: writeFile,
    bash,
    git,
    // web_fetch ignores the cwd argument every other executor uses - a fetch has no
    // project-relative path to resolve.
    web_fetch: webFetch,
    // The only executor that reads the third argument: it needs the turn's abort signal,
    // its accounting record, and which model to run a worker on.
    explore,
};

/**
 * What every tool put into the conversation over one turn, accumulated as the turn runs.
 *
 * Exists because `usage.inputTokens` (see chat-stream.ts) reports how big the prompt got
 * but never *why*: every tool result is replayed verbatim on every later request (see
 * toolPartsToMessages), so a single grep's output is carried for the rest of the session,
 * and today there is no way to see which tool is responsible for a full window.
 *
 * An object rather than a bare Map because it's the per-turn accounting record, not just
 * a tool tally - subagent token spend and the spawn budget hang off this same value, with
 * the same lifetime.
 *
 * Deliberately mutable and deliberately not exported as state: one is created per
 * buildProjectTools call (i.e. per turn), closed over by that turn's executors, and read
 * once when the turn ends. Nothing outlives the request - same reasoning as
 * `seenNestedInstructions` below.
 */
export type TurnToolAccounting = {
    perTool: Map<ToolName, { calls: number; resultChars: number }>;
    /** Workers actually spawned this turn, across every worker type. Bounded by
     * MAX_SUBAGENT_SPAWNS_PER_TURN - which is a separate axis from either step cap, since
     * parallel spawns all land inside a single step and stepCountIs never sees them. */
    subagentSpawns: number;
    /** Summed across every worker this turn. Kept apart from the turn's own usage on
     * purpose: this is real spend that never enters the orchestrator's context window, so
     * folding it in would overstate how full the window is. */
    subagentInputTokens: number;
    subagentOutputTokens: number;
};

export function createTurnToolAccounting(): TurnToolAccounting {
    return { perTool: new Map(), subagentSpawns: 0, subagentInputTokens: 0, subagentOutputTokens: 0 };
}

/** The turn's worker spend, as the wire schema shapes it - or undefined when no worker
 * ran, which is most turns. */
export function toSubagentUsage(accounting: TurnToolAccounting): SubagentUsage | undefined {
    if (accounting.subagentSpawns === 0) return undefined;

    return {
        count: accounting.subagentSpawns,
        inputTokens: accounting.subagentInputTokens,
        outputTokens: accounting.subagentOutputTokens,
    };
}

/** The accumulated per-tool tally, as the wire schema shapes it. Insertion-ordered, so
 * tools appear in the order they were first called rather than alphabetically - which is
 * also the order a reader scanning a turn expects. Empty when no tool ran. */
export function toToolUsage(accounting: TurnToolAccounting): ToolUsage[] {
    return [...accounting.perTool].map(([toolName, { calls, resultChars }]) => ({ toolName, calls, resultChars }));
}

function record(accounting: TurnToolAccounting, name: ToolName, resultChars: number): void {
    const entry = accounting.perTool.get(name);
    if (entry === undefined) {
        accounting.perTool.set(name, { calls: 1, resultChars });
        return;
    }

    entry.calls += 1;
    entry.resultChars += resultChars;
}

/**
 * Builds the tool set streamText attaches for a tool-capable request, every
 * execute() resolved against the request's own `cwd`. Pass `restricted: true`
 * (Talk mode) to expose only the tools isTalkTool allows - not the same set
 * as "runs without approval" (see toolNeedsApproval): a network tool is
 * Talk-visible but still needs approval, since it leaves the machine even
 * though it doesn't write to disk.
 *
 * `skipApproval` (Yolo mode) overrides every tool's `needsApproval` to false,
 * regardless of what toolNeedsApproval says - this, not anything in the CLI,
 * is where the approval gate actually gets bypassed: streamText never emits a
 * tool-approval-request part for a tool whose needsApproval is false (see
 * chat-stream.ts). It's independent of `restricted` - the two combine freely,
 * though in practice Yolo is always called with `restricted: false`.
 *
 * `includeProjectInstructions` (default on) additionally controls read_file's own
 * nested-instructions discovery (see project-instructions.ts) - the same off-switch that
 * disables the global/project files in the system prompt turns this off too, one on/off
 * idea rather than a per-source toggle. The dedup Set lives here, in a fresh
 * buildProjectTools call per turn, so a nested file surfaces once per directory per turn
 * without any state outliving the request.
 */
export type BuildProjectToolsOptions = {
    /** The project root every tool path resolves against. */
    cwd: string;
    /** Talk mode: expose only the tools isTalkTool allows. Ignored when `only` is set. */
    restricted?: boolean;
    includeProjectInstructions?: boolean;
    /** Yolo mode: force every tool's needsApproval to false. */
    skipApproval?: boolean;
    accounting?: TurnToolAccounting;
    /**
     * An explicit toolset, naming exactly which tools to expose. Used to build a subagent
     * worker's tools (see SUBAGENT_REGISTRY), where the set is a fixed list rather than a
     * predicate over the catalog. Takes precedence over `restricted`, which it has nothing
     * to do with - a worker's toolset is chosen, not filtered.
     */
    only?: readonly ToolName[];
    /** Which models a spawned worker may run on. Absent for a worker's own toolset, which
     * cannot spawn anything (one level, no trees). */
    workerModel?: WorkerModelChoice;
};

export function buildProjectTools({
    cwd,
    restricted = false,
    includeProjectInstructions = true,
    skipApproval = false,
    accounting,
    only,
    workerModel,
}: BuildProjectToolsOptions): ToolSet {
    const tools: ToolSet = {};
    const seenNestedInstructions = includeProjectInstructions ? new Set<string>() : undefined;

    const executors: Record<ToolName, ToolExecutor> = {
        ...TOOL_EXECUTORS,
        // Wrapped rather than used directly: read_file's own third parameter is this
        // turn's nested-instructions dedup set, not the executor context every other tool
        // receives.
        read_file: (input: any, toolCwd: string) => readFile(input, toolCwd, seenNestedInstructions),
    };

    const context: ToolExecutorContext = { accounting, workerModel };

    for (const definition of TOOL_CATALOG) {
        if (only !== undefined) {
            // A worker's toolset is named outright, so it is the one caller that can reach
            // the search tools (see WORKER_ONLY_TOOLS).
            if (!only.includes(definition.name)) continue;
        } else {
            // Everything else is the assistant itself, which never gets them - the reason
            // is on WORKER_ONLY_TOOLS, and it is the whole point of this branch.
            if (!isOrchestratorTool(definition.name)) continue;
            if (restricted && !isTalkTool(definition.name)) continue;
        }

        const executor = executors[definition.name];
        tools[definition.name] = tool<any, string, Record<string, unknown>>({
            description: definition.description,
            inputSchema: definition.inputSchema,
            // Tools that only read state run immediately; everything else
            // pauses the turn until the CLI approves or denies it (see
            // chat-stream.ts and toolNeedsApproval) - unless skipApproval
            // (Yolo) overrides that for every tool, gated or not.
            needsApproval: skipApproval ? false : toolNeedsApproval(definition.name),
            execute: async (input: any, { abortSignal }: { abortSignal?: AbortSignal } = {}) => {
                // try/catch rather than .catch() on the promise: an executor is free to
                // throw synchronously before it ever returns one, and only this form
                // catches both.
                let result: string;
                try {
                    result = await executor(input, cwd, { ...context, abortSignal });
                } catch (error) {
                    result = `Error: ${error instanceof Error ? error.message : String(error)}`;
                }

                // Recorded here, the one place every result passes through - the error
                // string included, since it lands in the conversation and gets replayed
                // on every later request exactly like a successful result does.
                if (accounting !== undefined) record(accounting, definition.name, result.length);
                return result;
            },
        });
    }

    return tools;
}
