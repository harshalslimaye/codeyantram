import {resolvedAgentSchema, type AgentApprovalPolicy, type BuiltinAgentId, type ResolvedAgent} from '@codeyantram/shared';
import {TOOL_CATALOG} from '../tools/catalog.js';
import {builtinAgentDefinition, composeAgentInstructions} from './instructions.js';

function resolveBuiltin(id: BuiltinAgentId, approval: AgentApprovalPolicy): ResolvedAgent {
  const definition = builtinAgentDefinition(id);
  for (const name of definition.tools) {
    const tool = TOOL_CATALOG.find(entry => entry.name === name);
    if (tool === undefined) throw new Error(`Bundled agent ${id} references an unknown tool.`);
    if (approval === 'none' && tool.capability !== 'workspace_read' && tool.capability !== 'network_read') {
      throw new Error(`Read-only bundled agent ${id} cannot use mutation tools.`);
    }
  }
  return resolvedAgentSchema.parse({
    id, name: definition.name, description: definition.description,
    source: 'builtin', approval, tools: definition.tools,
    instructions: composeAgentInstructions(id),
  });
}

/** Bundled Markdown defines content and tool lists; the host owns approval. */
export const BUILTIN_AGENTS: readonly ResolvedAgent[] = [
  resolveBuiltin('ask', 'none'),
  resolveBuiltin('build', 'prompt'),
  resolveBuiltin('yolo', 'automatic'),
];
