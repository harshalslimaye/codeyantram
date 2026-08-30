import { z } from "zod";

type ToolDefinition = {
    name: string;
    description: string;
    inputSchema: z.ZodType;
};

export const TOOL_CATALOG = [
    {
        name: "read_file",
        description: "Read the contents of a file, given a path relative to the project root.",
        inputSchema: z.object({
            path: z.string().min(1),
        }),
    },
    {
        name: "list_dir",
        description: "List files and directories at a path relative to the project root.",
        inputSchema: z.object({
            path: z.string().min(1).default("."),
        }),
    },
    {
        name: "glob",
        description: "Find files matching a glob pattern, relative to the project root.",
        inputSchema: z.object({
            pattern: z.string().min(1),
        }),
    },
    {
        name: "grep",
        description:
            "Search file contents for a regular expression pattern, relative to the project root. Prefer read_file/glob for known paths - use this to search across files.",
        inputSchema: z.object({
            pattern: z.string().min(1),
            path: z.string().min(1).default("."),
        }),
    },
    {
        name: "edit_file",
        description: "Replace one exact snippet of text in a file with new text.",
        inputSchema: z.object({
            path: z.string().min(1),
            oldText: z.string().min(1),
            newText: z.string(),
        }),
    },
    {
        name: "write_file",
        description: "Create a file, or overwrite it entirely, with the given content.",
        inputSchema: z.object({
            path: z.string().min(1),
            content: z.string(),
        }),
    },
    {
        name: "bash",
        description: "Run a shell command in the project root and return its output.",
        inputSchema: z.object({
            command: z.string().min(1),
        }),
    },
] as const satisfies readonly ToolDefinition[];

export type ToolName = (typeof TOOL_CATALOG)[number]["name"];

// Tools that only read state. Everything else (edit_file, write_file, bash)
// mutates the project or the machine and needs approval before it runs.
export const READ_ONLY_TOOLS: readonly ToolName[] = ["read_file", "list_dir", "glob", "grep"];

export function isReadOnlyTool(name: ToolName): boolean {
    return READ_ONLY_TOOLS.includes(name);
}

export const SUPPORTED_TOOL_NAMES: ToolName[] = TOOL_CATALOG.map(tool => tool.name);

export const toolNameSchema = z.enum(SUPPORTED_TOOL_NAMES);

export function findToolDefinition(name: string): (typeof TOOL_CATALOG)[number] | undefined {
    return TOOL_CATALOG.find(tool => tool.name === name);
}
