export const AGENT_NAMES = ["Talk", "Build", "Yolo"] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

// All three get tool access; Talk is the only one without mutating tools.
export const TOOL_CAPABLE_AGENTS: readonly AgentName[] = ["Talk", "Build", "Yolo"];

// Talk is restricted to read-only tools (see isReadOnlyTool); Build and Yolo
// both get the full catalog, including edit_file/write_file/bash - they
// differ only in whether a mutating call needs approval first (see
// agentBypassesApproval).
export const FULL_TOOL_AGENTS: readonly AgentName[] = ["Build", "Yolo"];

export function agentHasTools(name: AgentName): boolean {
    return TOOL_CAPABLE_AGENTS.includes(name);
}

export function agentHasFullToolAccess(name: AgentName): boolean {
    return FULL_TOOL_AGENTS.includes(name);
}

// Agents whose mutating tool calls run without pausing for user approval.
// Kept separate from toolNeedsApproval (tools.ts) - that one is a pure
// per-tool concept ("can this ever need approval"), this one is a per-agent
// override of it. Today only Yolo bypasses; Build still gates every
// mutating call.
export const APPROVAL_BYPASS_AGENTS: readonly AgentName[] = ["Yolo"];

export function agentBypassesApproval(name: AgentName): boolean {
    return APPROVAL_BYPASS_AGENTS.includes(name);
}
