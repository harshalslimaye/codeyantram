import { tool, type ToolSet } from 'ai';
import { TOOL_CATALOG, isReadOnlyTool, type ToolName } from '@codeyantram/shared';
import { execute as bash } from './bash';
import { execute as editFile } from './edit-file';
import { execute as glob } from './glob';
import { execute as grep } from './grep';
import { execute as listDir } from './list-dir';
import { execute as readFile } from './read-file';
import { execute as writeFile } from './write-file';

// Each executor's parameter type already matches its own catalog entry's
// inputSchema; the map itself has to widen to `any` since the shapes differ per tool.
const TOOL_EXECUTORS: Record<ToolName, (input: any, cwd: string) => Promise<string>> = {
    read_file: readFile,
    list_dir: listDir,
    glob,
    grep,
    edit_file: editFile,
    write_file: writeFile,
    bash,
};

/** Builds the tool set streamText attaches for a Build-mode request, every execute() resolved against the request's own `cwd`. */
export function buildProjectTools(cwd: string): ToolSet {
    const tools: ToolSet = {};

    for (const definition of TOOL_CATALOG) {
        const executor = TOOL_EXECUTORS[definition.name];
        tools[definition.name] = tool<any, string, Record<string, unknown>>({
            description: definition.description,
            inputSchema: definition.inputSchema,
            // Read-only tools run immediately; everything else pauses the
            // turn until the CLI approves or denies it (see chat-stream.ts).
            needsApproval: !isReadOnlyTool(definition.name),
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
