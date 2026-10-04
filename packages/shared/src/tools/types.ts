import type {z} from 'zod';
import type {
  toolCallIdSchema,
  toolCallPartSchema,
  toolCallSchema,
  toolDefinitionSchema,
  toolErrorCodeSchema,
  toolErrorSchema,
  toolInputSchema,
  toolMessagePartSchema,
  toolNameSchema,
  toolOutputSchema,
  toolResultPartSchema,
  toolResultSchema,
  toolStreamEventSchema,
} from './schemas.js';

export type ToolName = z.infer<typeof toolNameSchema>;
export type ToolCallId = z.infer<typeof toolCallIdSchema>;
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
export type ToolInput = z.infer<typeof toolInputSchema>;
export type ToolOutput = z.infer<typeof toolOutputSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolErrorCode = z.infer<typeof toolErrorCodeSchema>;
export type ToolError = z.infer<typeof toolErrorSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;
export type ToolResultPart = z.infer<typeof toolResultPartSchema>;
export type ToolMessagePart = z.infer<typeof toolMessagePartSchema>;
export type ToolStreamEvent = z.infer<typeof toolStreamEventSchema>;
