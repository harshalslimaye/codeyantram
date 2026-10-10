import {resolvedAgentSchema, type ResolvedAgent} from '@codeyantram/shared';
import {TOOL_CATALOG} from '../tools/catalog.js';
import {composeAgentInstructions} from './instructions.js';

const readTools = TOOL_CATALOG.filter(entry => entry.capability === 'workspace_read' || entry.capability === 'network_read')
  .map(entry => entry.name);
const buildTools = TOOL_CATALOG.map(entry => entry.name);

/** Definitions only: host authorization and tool availability are resolved later. */
export const BUILTIN_AGENTS: readonly ResolvedAgent[] = [
  resolvedAgentSchema.parse({
    id: 'ask', name: 'Ask', description: 'Explore the workspace and answer questions without changing files.',
    source: 'builtin', approval: 'none', tools: readTools,
    instructions: composeAgentInstructions('ask'),
  }),
  resolvedAgentSchema.parse({
    id: 'build', name: 'Build', description: 'Make changes after approval for each patch or command.',
    source: 'builtin', approval: 'prompt', tools: buildTools,
    instructions: composeAgentInstructions('build'),
  }),
  resolvedAgentSchema.parse({
    id: 'yolo', name: 'Yolo', description: 'Make changes without per-action prompts when the host enables it.',
    source: 'builtin', approval: 'automatic', tools: buildTools,
    instructions: composeAgentInstructions('yolo'),
  }),
];
