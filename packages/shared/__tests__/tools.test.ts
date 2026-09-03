import { describe, expect, test } from "bun:test";
import {
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
