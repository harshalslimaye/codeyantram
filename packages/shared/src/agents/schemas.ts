import {z} from 'zod';
import {toolNameSchema} from '../tools/schemas.js';

const MAX_AGENT_NAME_CHARACTERS = 80;
const MAX_AGENT_DESCRIPTION_CHARACTERS = 240;
const MAX_AGENT_INSTRUCTIONS_CHARACTERS = 16_000;
const MAX_AGENT_TOOLS = 32;

export const builtinAgentIdSchema = z.enum(['ask', 'build', 'yolo']);
export const customAgentIdSchema = z.string().regex(/^(?:user|project):[a-z][a-z0-9-]{0,63}$/);
export const agentIdSchema = z.union([builtinAgentIdSchema, customAgentIdSchema]);
export const agentSourceSchema = z.enum(['builtin', 'user', 'project']);
export const agentApprovalPolicySchema = z.enum(['none', 'prompt', 'automatic']);

const nameSchema = z.string().trim().min(1).max(MAX_AGENT_NAME_CHARACTERS);
const descriptionSchema = z.string().trim().min(1).max(MAX_AGENT_DESCRIPTION_CHARACTERS);
const instructionsSchema = z.string().trim().min(1).max(MAX_AGENT_INSTRUCTIONS_CHARACTERS);
const toolsSchema = z.array(toolNameSchema).max(MAX_AGENT_TOOLS).refine(
  tools => new Set(tools).size === tools.length,
  {message: 'Agent tools must not contain duplicates.'},
);

/** File/built-in authoring shape; a loader may derive id and name before validation. */
export const agentDefinitionSchema = z.strictObject({
  id: agentIdSchema,
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  instructions: instructionsSchema,
  extends: builtinAgentIdSchema.default('ask'),
  tools: toolsSchema.optional(),
});

/** Host-resolved, per-turn policy. Parsing this shape does not itself authorize it. */
export const resolvedAgentSchema = z.strictObject({
  id: agentIdSchema,
  name: nameSchema,
  description: descriptionSchema,
  instructions: instructionsSchema,
  source: agentSourceSchema,
  tools: toolsSchema,
  approval: agentApprovalPolicySchema,
}).superRefine((agent, context) => {
  const expected = agent.source === 'builtin' ? builtinAgentIdSchema.safeParse(agent.id).success
    : agent.id.startsWith(`${agent.source}:`);
  if (!expected) context.addIssue({code: 'custom', message: 'Agent ID must match its source.', path: ['id']});
});

/** Safe metadata for a picker; instructions stay in the server-owned registry. */
export const agentMetadataSchema = z.strictObject({
  id: agentIdSchema,
  name: nameSchema,
  description: descriptionSchema,
  source: agentSourceSchema,
  tools: toolsSchema,
  approval: agentApprovalPolicySchema,
  available: z.boolean(),
});
