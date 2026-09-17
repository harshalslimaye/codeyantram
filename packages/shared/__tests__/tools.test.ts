import { describe, expect, test } from "bun:test";
import {
    GIT_READ_ONLY_SUBCOMMANDS,
    NETWORK_TOOLS,
    READ_ONLY_TOOLS,
    SUBAGENT_NAMES,
    SUBAGENT_REGISTRY,
    WORKER_ONLY_TOOLS,
    TOOL_CATALOG,
    findToolDefinition,
    isReadOnlyTool,
    isOrchestratorTool,
    isSubagentTool,
    isTalkTool,
    isWorkerOnlyTool,
    subagentTools,
    toolNameSchema,
    toolNeedsApproval,
    type SubagentName,
} from "../src/tools";

describe("TOOL_CATALOG", () => {
    test("every tool name is unique", () => {
        const names = TOOL_CATALOG.map(tool => tool.name);
        expect(new Set(names).size).toBe(names.length);
    });

    test("every tool has a non-empty description", () => {
        for (const tool of TOOL_CATALOG) {
            expect(tool.description.length).toBeGreaterThan(0);
        }
    });

    test("every read-only tool is a real catalog entry", () => {
        const names = TOOL_CATALOG.map(tool => tool.name);
        for (const name of READ_ONLY_TOOLS) {
            expect(names).toContain(name);
        }
    });

    test("every network tool is a real catalog entry", () => {
        const names = TOOL_CATALOG.map(tool => tool.name);
        for (const name of NETWORK_TOOLS) {
            expect(names).toContain(name);
        }
    });

    test("read-only and network tools don't overlap", () => {
        for (const name of NETWORK_TOOLS) {
            expect(READ_ONLY_TOOLS).not.toContain(name);
        }
    });
});

describe("findToolDefinition", () => {
    test("finds a known tool by name", () => {
        expect(findToolDefinition("read_file")?.description).toBeTruthy();
    });

    test("returns undefined for an unknown name", () => {
        expect(findToolDefinition("delete_everything")).toBeUndefined();
    });
});

describe("isReadOnlyTool", () => {
    test("is true for read_file", () => {
        expect(isReadOnlyTool("read_file")).toBe(true);
    });

    test("is false for a mutating tool", () => {
        expect(isReadOnlyTool("bash")).toBe(false);
        expect(isReadOnlyTool("write_file")).toBe(false);
        expect(isReadOnlyTool("edit_file")).toBe(false);
    });
});

describe("isTalkTool", () => {
    test("is true for every read-only tool", () => {
        for (const name of READ_ONLY_TOOLS) {
            expect(isTalkTool(name)).toBe(true);
        }
    });

    test("is true for every network tool", () => {
        for (const name of NETWORK_TOOLS) {
            expect(isTalkTool(name)).toBe(true);
        }
    });

    test("is false for a mutating tool", () => {
        expect(isTalkTool("bash")).toBe(false);
        expect(isTalkTool("write_file")).toBe(false);
        expect(isTalkTool("edit_file")).toBe(false);
        expect(isTalkTool("undo_edit")).toBe(false);
    });
});

describe("toolNeedsApproval", () => {
    test("is false for every read-only tool", () => {
        for (const name of READ_ONLY_TOOLS) {
            expect(toolNeedsApproval(name)).toBe(false);
        }
    });

    test("is true for every network tool", () => {
        for (const name of NETWORK_TOOLS) {
            expect(toolNeedsApproval(name)).toBe(true);
        }
    });

    test("is true for a mutating tool", () => {
        expect(toolNeedsApproval("bash")).toBe(true);
        expect(toolNeedsApproval("write_file")).toBe(true);
        expect(toolNeedsApproval("edit_file")).toBe(true);
        expect(toolNeedsApproval("undo_edit")).toBe(true);
    });
});

describe("the git tool", () => {
    const inputSchema = findToolDefinition("git")!.inputSchema;

    test("is classified read-only, so it runs unprompted and Talk can see it", () => {
        expect(isReadOnlyTool("git")).toBe(true);
        expect(toolNeedsApproval("git")).toBe(false);
        expect(isTalkTool("git")).toBe(true);
    });

    test("accepts every subcommand on the allowlist", () => {
        for (const command of GIT_READ_ONLY_SUBCOMMANDS) {
            expect(inputSchema.safeParse({ command }).success).toBe(true);
        }
    });

    test("rejects a writing subcommand at the schema, before any executor sees it", () => {
        for (const command of ["commit", "add", "checkout", "push", "merge", "reset", "rebase"]) {
            expect(inputSchema.safeParse({ command }).success).toBe(false);
        }
    });

    // These list refs, but each also *writes* under the same name (`git stash` alone
    // pushes a stash, `git branch <name>` creates one), so they're off the allowlist
    // rather than being allowed with per-subcommand exceptions.
    test("rejects the ref-listing subcommands that double as writing ones", () => {
        for (const command of ["branch", "tag", "stash", "remote", "reflog"]) {
            expect(inputSchema.safeParse({ command }).success).toBe(false);
        }
    });

    test("takes arguments as separate entries rather than one shell-style string", () => {
        expect(inputSchema.safeParse({ command: "log", args: ["-n", "5", "--oneline"] }).success).toBe(true);
        expect(inputSchema.safeParse({ command: "log", args: "-n 5 --oneline" }).success).toBe(false);
    });

    test("names every subcommand it allows in its description, so the model needn't guess", () => {
        const description = findToolDefinition("git")?.description ?? "";
        for (const command of GIT_READ_ONLY_SUBCOMMANDS) {
            expect(description).toContain(command);
        }
    });

    test("tells the model that refs are arguments, since no subcommand lists them", () => {
        const description = findToolDefinition("git")?.description ?? "";
        expect(description).toContain("--decorate");
    });
});

describe("toolNameSchema", () => {
    test("accepts every catalog name", () => {
        for (const tool of TOOL_CATALOG) {
            expect(toolNameSchema.safeParse(tool.name).success).toBe(true);
        }
    });

    test("rejects an unknown tool name", () => {
        expect(toolNameSchema.safeParse("rm_rf").success).toBe(false);
    });
});


describe("SUBAGENT_REGISTRY", () => {
    // Written as a loop over the registry rather than against `explore` by name, so a
    // worker type added later is covered by every invariant here the moment it appears.
    test.each(SUBAGENT_NAMES)("%s: cannot spawn a worker of its own", name => {
        for (const tool of subagentTools(name)) {
            expect(isSubagentTool(tool)).toBe(false);
        }
    });

    // The hard one. Subagent tools cannot use the approval gate at all - the AI SDK runs
    // them unconditionally - so a mutating tool here would execute with no prompt and no
    // way to add one. This test is the only thing standing between that and a one-word
    // edit to the registry.
    test.each(SUBAGENT_NAMES)("%s: every tool it can call is read-only", name => {
        for (const tool of subagentTools(name)) {
            expect(READ_ONLY_TOOLS).toContain(tool);
        }
    });

    test.each(SUBAGENT_NAMES)("%s: cannot reach the network", name => {
        for (const tool of subagentTools(name)) {
            expect(NETWORK_TOOLS).not.toContain(tool);
        }
    });

    // Fewer than two and it cannot compress: discarding requires knowing what is relevant,
    // and confirming that requires opening something. See the registry's own comment.
    test.each(SUBAGENT_NAMES)("%s: has enough tools to iterate on its own question", name => {
        expect(subagentTools(name).length).toBeGreaterThan(1);
    });

    test.each(SUBAGENT_NAMES)("%s: names only tools that exist in the catalog", name => {
        for (const tool of subagentTools(name)) {
            expect(findToolDefinition(tool)).toBeDefined();
        }
    });

    test.each(SUBAGENT_NAMES)("%s: is itself a catalog tool the orchestrator can call", name => {
        expect(findToolDefinition(name)).toBeDefined();
    });

    // Every worker tool runs without pausing the turn, which is only safe because of the
    // read-only invariant above - the two are asserted separately so neither silently
    // starts standing in for the other.
    test.each(SUBAGENT_NAMES)("%s: runs without an approval prompt", name => {
        expect(toolNeedsApproval(name as SubagentName)).toBe(false);
    });

    test("isSubagentTool rejects an ordinary tool and an unknown name", () => {
        expect(isSubagentTool("grep")).toBe(false);
        expect(isSubagentTool("nonexistent")).toBe(false);
    });

    test("explore searches the working tree and can read what it finds", () => {
        expect(SUBAGENT_REGISTRY.explore.tools).toEqual(["glob", "grep", "list_dir", "read_file"]);
    });
});

describe("explore", () => {
    const inputSchema = findToolDefinition("explore")!.inputSchema;

    test("accepts a self-contained task", () => {
        expect(inputSchema.safeParse({ task: "Find where entitlements are assembled; report path:line" }).success).toBe(true);
    });

    // min(10) only rejects degenerate input - it cannot tell a bare keyword from a task,
    // since "entitlements" is twelve characters and useless while "find getEntitlements"
    // is twenty and fine. What actually gets a usable task written is the tool
    // description and the worker's own prompt; this is just a floor.
    test("rejects an empty or stub task", () => {
        expect(inputSchema.safeParse({ task: "" }).success).toBe(false);
        expect(inputSchema.safeParse({ task: "find it" }).success).toBe(false);
        expect(inputSchema.safeParse({ task: undefined }).success).toBe(false);
    });

    test("takes no path, pattern, or other search parameter - the task is the whole input", () => {
        const parsed = inputSchema.safeParse({ task: "Find the approval gate", pattern: "approval", path: "src" });
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data).toEqual({ task: "Find the approval gate" });
    });

    // Its description is the only thing routing the orchestrator here instead of straight
    // to grep, so the parts that do the routing are asserted rather than left to drift.
    test("description says what it returns, what it cannot see, and when not to use it", () => {
        const description = findToolDefinition("explore")?.description ?? "";
        expect(description).toContain("path:line");
        expect(description).toContain("own context");
        expect(description).toContain("git history");
        expect(description).toContain("self-contained");
        expect(description).toContain("concurrently");
        expect(description).toContain("already know the file and line");
    });

    test("is available to Talk, which is the most search-heavy agent", () => {
        expect(isTalkTool("explore")).toBe(true);
        expect(isReadOnlyTool("explore")).toBe(true);
    });
});


describe("WORKER_ONLY_TOOLS", () => {
    // Searching is a worker's job; reading a known path is not. The reason this lives in
    // the catalog rather than in a prompt is measured: with these tools available the model
    // reached for them directly, delegating on one turn out of three and re-running the
    // search itself on that turn anyway. Tool descriptions and system-prompt wording were
    // both tried first and did not change it.
    test("withholds every search tool from the assistant", () => {
        for (const tool of ["grep", "glob", "list_dir"] as const) {
            expect(WORKER_ONLY_TOOLS).toContain(tool);
            expect(isWorkerOnlyTool(tool)).toBe(true);
            expect(isOrchestratorTool(tool)).toBe(false);
        }
    });

    // The one tool that must never move here. edit_file matches oldText byte-exactly, and a
    // worker's answer is model-generated text with no guarantee of matching the file
    // character for character - withhold this and editing stops being reliable. It was
    // briefly withheld, and that is what brought it back.
    test("keeps read_file with the assistant", () => {
        expect(WORKER_ONLY_TOOLS).not.toContain("read_file");
        expect(isOrchestratorTool("read_file")).toBe(true);
    });

    test("explore itself is the assistant's, not a worker's", () => {
        expect(isOrchestratorTool("explore")).toBe(true);
        expect(isWorkerOnlyTool("explore")).toBe(false);
    });

    // Otherwise the split would take a tool from the assistant and give it to nobody -
    // removing the capability instead of relocating it.
    test("everything withheld is available to some worker", () => {
        for (const tool of WORKER_ONLY_TOOLS) {
            const owners = SUBAGENT_NAMES.filter(name => (subagentTools(name) as readonly string[]).includes(tool));
            expect(owners.length).toBeGreaterThan(0);
        }
    });

    // Shaping the default path, not closing it: bash can still grep. Recorded so the gap
    // stays known rather than overlooked - the system prompt is what covers it.
    test("does not withhold bash, which can still search", () => {
        expect(isWorkerOnlyTool("bash")).toBe(false);
    });
});
