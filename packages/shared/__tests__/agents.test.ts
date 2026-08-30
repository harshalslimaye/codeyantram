import { describe, expect, test } from "bun:test";
import { AGENT_NAMES, agentHasTools } from "../src/agents";

describe("agentHasTools", () => {
    test("is false for Talk", () => {
        expect(agentHasTools("Talk")).toBe(false);
    });

    test("is true for Build", () => {
        expect(agentHasTools("Build")).toBe(true);
    });

    test("every agent name resolves to a defined boolean", () => {
        for (const name of AGENT_NAMES) {
            expect(typeof agentHasTools(name)).toBe("boolean");
        }
    });
});
