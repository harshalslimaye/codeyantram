import {BUILTIN_AGENTS} from '@codeyantram/core';
import {agentMetadataSchema, type AgentMetadata} from '@codeyantram/shared';

/** Shown only until the private server responds or in component-only hosts. */
export const FALLBACK_AGENT_METADATA: readonly AgentMetadata[] = Object.freeze(BUILTIN_AGENTS.map(agent => ({
  id: agent.id, name: agent.name, description: agent.description, source: agent.source,
  approval: agent.approval, tools: [], available: agent.id !== 'yolo',
})));

export async function loadAgentMetadata(baseUrl: string, fetchResponse: typeof fetch): Promise<AgentMetadata[]> {
  const response = await fetchResponse(new URL('/agents', baseUrl));
  if (!response.ok) throw new Error(`Could not load agents (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('The agent list is invalid.');
  return payload.map(entry => agentMetadataSchema.parse(entry));
}
