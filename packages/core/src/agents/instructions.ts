import {readFileSync} from 'node:fs';
import {agentDefinitionSchema, parseAgentMarkdown, type BuiltinAgentId} from '@codeyantram/shared';

function readBundled(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8').trim(); // oxlint-disable-line security/detect-non-literal-fs-filename -- Names below are fixed bundled files.
}

export const BASE_AGENT_INSTRUCTIONS = readBundled('base.md');

const definitions = {
  ask: agentDefinitionSchema.parse(parseAgentMarkdown(readBundled('ask.md'), 'ask')),
  build: agentDefinitionSchema.parse(parseAgentMarkdown(readBundled('build.md'), 'build')),
  yolo: agentDefinitionSchema.parse(parseAgentMarkdown(readBundled('yolo.md'), 'yolo')),
};

export const ASK_AGENT_INSTRUCTIONS = definitions.ask.instructions;
export const BUILD_AGENT_INSTRUCTIONS = definitions.build.instructions;
export const YOLO_AGENT_INSTRUCTIONS = definitions.yolo.instructions;

export function builtinAgentDefinition(id: BuiltinAgentId): {name: string; description: string; tools: NonNullable<typeof definitions.ask.tools>} {
  const definition = definitions[id]; // oxlint-disable-line security/detect-object-injection -- The ID is a closed enum.
  if (typeof definition.name !== 'string' || typeof definition.description !== 'string' || definition.tools === undefined) {
    throw new TypeError(`Bundled agent ${id} needs a name, description, and tools.`);
  }
  return {name: definition.name, description: definition.description, tools: definition.tools};
}

/** Custom agents append their instructions to the universal and mode text. */
export function composeAgentInstructions(mode: BuiltinAgentId, customInstructions?: string): string {
  if (!Object.hasOwn(definitions, mode)) throw new Error(`Unknown agent mode: ${mode}`);
  const modeInstructions = definitions[mode].instructions; // oxlint-disable-line security/detect-object-injection -- The mode is a closed enum.
  return [BASE_AGENT_INSTRUCTIONS, modeInstructions, customInstructions].filter(Boolean).join('\n\n');
}
