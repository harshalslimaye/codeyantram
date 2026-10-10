import {agentDefinitionSchema, resolvedAgentSchema, type AgentSource, type ResolvedAgent} from '@codeyantram/shared';
import {TOOL_CATALOG} from '../tools/catalog.js';
import {BUILTIN_AGENTS} from './builtins.js';
import {composeAgentInstructions} from './instructions.js';

export interface CustomAgentEntry {
  source: Exclude<AgentSource, 'builtin'>;
  definition: unknown;
  filePath?: string;
}

export interface AgentDiagnostic {
  source: CustomAgentEntry['source'];
  filePath?: string;
  message: string;
}

export interface AgentRegistry {
  list(): readonly ResolvedAgent[];
  get(id: string): ResolvedAgent | undefined;
  diagnostics(): readonly AgentDiagnostic[];
}

const knownTools = new Set<string>(TOOL_CATALOG.map(entry => entry.name));

function snapshot(agent: ResolvedAgent): ResolvedAgent {
  return Object.freeze({...agent, tools: Object.freeze([...agent.tools])}) as ResolvedAgent;
}

function displayName(id: string): string {
  const slug = id.slice(id.indexOf(':') + 1);
  return slug.split('-').map(word => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' ');
}

function resolveCustom(entry: CustomAgentEntry): ResolvedAgent {
  const definition = agentDefinitionSchema.parse(entry.definition);
  if (!definition.id.startsWith(`${entry.source}:`)) throw new Error('Agent ID must match its source.');
  const base = BUILTIN_AGENTS.find(agent => agent.id === definition.extends);
  if (!base) throw new Error('Unknown base agent.');
  const tools = definition.tools ?? base.tools;
  const baseTools = new Set(base.tools);
  if (tools.some(name => !knownTools.has(name) || !baseTools.has(name))) {
    throw new Error('Agent tools must be known tools from the selected base agent.');
  }
  return resolvedAgentSchema.parse({
    id: definition.id,
    name: definition.name ?? displayName(definition.id),
    description: definition.description ?? `Custom agent based on ${base.name}.`,
    instructions: composeAgentInstructions(definition.extends, definition.instructions),
    source: entry.source,
    tools,
    approval: base.approval,
  });
}

/** Resolves data only; host tool availability and automatic approval remain separate. */
export function createAgentRegistry(customEntries: readonly CustomAgentEntry[] = []): AgentRegistry {
  const agents = new Map<string, ResolvedAgent>(BUILTIN_AGENTS.map(agent => [agent.id, snapshot(agent)]));
  const diagnostics: AgentDiagnostic[] = [];
  for (const entry of customEntries) {
    try {
      const agent = resolveCustom(entry);
      if (agents.has(agent.id)) throw new Error(`Duplicate agent ID: ${agent.id}`);
      agents.set(agent.id, snapshot(agent));
    } catch (error) {
      diagnostics.push({source: entry.source, ...(entry.filePath === undefined ? {} : {filePath: entry.filePath}),
        message: error instanceof Error ? error.message : 'Invalid agent definition.'});
    }
  }
  return {
    list: () => Object.freeze([...agents.values()]),
    get: id => agents.get(id),
    diagnostics: () => Object.freeze([...diagnostics]),
  };
}
