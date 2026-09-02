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
        description:
            "List files and directories at a path relative to the project root. Marks directories with a trailing slash, resolving symlinks to their real type. Hides dotfiles/dotdirs unless includeHidden is set. Pass recursive (or depth) to descend into subdirectories instead of just the top level - node_modules, .git, dist, and build are skipped while descending, same as grep. Pass withMetadata for a tab-separated path/type/size/mtime line per entry instead of just the name, e.g. to tell a symlink apart from a real file or directory.",
        inputSchema: z.object({
            path: z.string().min(1).default("."),
            maxResults: z.number().int().min(1).max(5000).default(500).describe("Cap on the number of entries returned."),
            includeHidden: z.boolean().optional().describe("Include dotfiles and dotdirs, which are hidden by default."),
            recursive: z.boolean().optional().describe("List subdirectories recursively instead of just the top level."),
            depth: z
                .number()
                .int()
                .min(1)
                .max(20)
                .optional()
                .describe("Limit recursion to this many directory levels; implies recursive. Defaults to a depth of 20 when recursive is set without one."),
            withMetadata: z
                .boolean()
                .optional()
                .describe("Return each entry as a tab-separated \"path\\ttype\\tsize\\tmtime\" line instead of just its name (type is file, dir, or symlink)."),
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
            "Search file contents for a regex pattern, relative to the project root, using ripgrep. Automatically skips node_modules, .git, dist, build, gitignored paths, and binary files. Pattern syntax is Rust regex, not POSIX ERE - no backreferences or lookaround. Use the ignoreCase, glob, contextLines, filesOnly, and maxResults options to filter and shape results instead of chaining separate glob+grep calls. Prefer read_file/glob for known paths - use this to search across files.",
        inputSchema: z.object({
            pattern: z.string().min(1),
            path: z.string().min(1).default("."),
            ignoreCase: z.boolean().optional().describe("Case-insensitive match."),
            glob: z.string().optional().describe("Restrict the search to files matching this glob, e.g. \"*.ts\"."),
            contextLines: z.number().int().min(0).max(20).optional().describe("Include this many lines of surrounding context before and after each match."),
            filesOnly: z.boolean().optional().describe("Return only the matching file paths, not line content."),
            maxResults: z.number().int().min(1).max(500).default(100).describe("Cap on the number of matches (or files, with filesOnly) returned."),
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
