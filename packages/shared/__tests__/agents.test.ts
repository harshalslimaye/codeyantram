import { describe, expect, test } from "bun:test";
import { AGENT_NAMES, agentBypassesApproval, agentHasFullToolAccess, agentHasTools } from "../src/agents";

describe("agentHasTools", () => {
    test("is true for Talk", () => {
        expect(agentHasTools("Talk")).toBe(true);
    });

    test("is true for Build", () => {
        expect(agentHasTools("Build")).toBe(true);
    });

    test("is true for Yolo", () => {
        expect(agentHasTools("Yolo")).toBe(true);
    });

    test("every agent name resolves to a defined boolean", () => {
        for (const name of AGENT_NAMES) {
            expect(typeof agentHasTools(name)).toBe("boolean");
        }
    });
});

describe("agentHasFullToolAccess", () => {
    test("is false for Talk", () => {
        expect(agentHasFullToolAccess("Talk")).toBe(false);
    });

    test("is true for Build", () => {
        expect(agentHasFullToolAccess("Build")).toBe(true);
    });

    test("is true for Yolo", () => {
        expect(agentHasFullToolAccess("Yolo")).toBe(true);
    });
});

describe("agentBypassesApproval", () => {
    test("is false for Talk", () => {
        expect(agentBypassesApproval("Talk")).toBe(false);
    });

    test("is false for Build", () => {
        expect(agentBypassesApproval("Build")).toBe(false);
    });

    test("is true for Yolo", () => {
        expect(agentBypassesApproval("Yolo")).toBe(true);
    });

    test("every agent name resolves to a defined boolean", () => {
        for (const name of AGENT_NAMES) {
            expect(typeof agentBypassesApproval(name)).toBe("boolean");
        }
    });
});
