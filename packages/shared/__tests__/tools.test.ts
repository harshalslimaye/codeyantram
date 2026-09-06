import { describe, expect, test } from "bun:test";
import {
    GIT_READ_ONLY_SUBCOMMANDS,
    NETWORK_TOOLS,
    READ_ONLY_TOOLS,
    TOOL_CATALOG,
    findToolDefinition,
    isReadOnlyTool,
    isTalkTool,
    toolNameSchema,
    toolNeedsApproval,
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
