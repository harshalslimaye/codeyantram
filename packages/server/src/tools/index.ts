import { tool, type ToolSet } from 'ai';
import { TOOL_CATALOG, isTalkTool, toolNeedsApproval, type ToolName } from '@codeyantram/shared';
import { execute as bash } from './bash';
import { execute as editFile, undo as undoEdit } from './edit-file';
import { execute as git } from './git';
import { execute as glob } from './glob';
import { execute as grep } from './grep';
import { execute as listDir } from './list-dir';
import { execute as readFile } from './read-file';
import { execute as webFetch } from './web-fetch';
import { execute as writeFile } from './write-file';

// Each executor's parameter type already matches its own catalog entry's
// inputSchema; the map itself has to widen to `any` since the shapes differ per tool.
const TOOL_EXECUTORS: Record<ToolName, (input: any, cwd: string) => Promise<string>> = {
    read_file: readFile,
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
};

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
export function buildProjectTools(cwd: string, restricted = false, includeProjectInstructions = true, skipApproval = false): ToolSet {
    const tools: ToolSet = {};
    const seenNestedInstructions = includeProjectInstructions ? new Set<string>() : undefined;

    const executors: Record<ToolName, (input: any, cwd: string) => Promise<string>> = {
        ...TOOL_EXECUTORS,
        read_file: (input: any, toolCwd: string) => readFile(input, toolCwd, seenNestedInstructions),
    };

    for (const definition of TOOL_CATALOG) {
        if (restricted && !isTalkTool(definition.name)) continue;

        const executor = executors[definition.name];
        tools[definition.name] = tool<any, string, Record<string, unknown>>({
            description: definition.description,
            inputSchema: definition.inputSchema,
            // Tools that only read state run immediately; everything else
            // pauses the turn until the CLI approves or denies it (see
            // chat-stream.ts and toolNeedsApproval) - unless skipApproval
            // (Yolo) overrides that for every tool, gated or not.
            needsApproval: skipApproval ? false : toolNeedsApproval(definition.name),
            execute: async (input: any) => {
                try {
                    return await executor(input, cwd);
                } catch (error) {
                    return `Error: ${error instanceof Error ? error.message : String(error)}`;
                }
            },
        });
    }

    return tools;
}
