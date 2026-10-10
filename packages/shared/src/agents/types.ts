import type {z} from 'zod';
import type {
  agentApprovalPolicySchema,
  agentDefinitionSchema,
  agentIdSchema,
  agentMetadataSchema,
  agentSourceSchema,
  builtinAgentIdSchema,
  resolvedAgentSchema,
} from './schemas.js';

export type AgentId = z.infer<typeof agentIdSchema>;
export type BuiltinAgentId = z.infer<typeof builtinAgentIdSchema>;
export type AgentSource = z.infer<typeof agentSourceSchema>;
export type AgentApprovalPolicy = z.infer<typeof agentApprovalPolicySchema>;
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
export type ResolvedAgent = z.infer<typeof resolvedAgentSchema>;
export type AgentMetadata = z.infer<typeof agentMetadataSchema>;
