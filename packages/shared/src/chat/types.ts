import type {z} from 'zod';
import type {
  assistantMessageSchema,
  chatErrorCodeSchema,
  chatMessageSchema,
  chatRequestSchema,
  chatStreamEventSchema,
  messagePartSchema,
  requestMessageSchema,
  textPartSchema,
  tokenUsageSchema,
  userMessageSchema,
} from './schemas.js';

export type TextPart = z.infer<typeof textPartSchema>;
export type MessagePart = z.infer<typeof messagePartSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type UserMessage = z.infer<typeof userMessageSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type RequestMessage = z.infer<typeof requestMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatErrorCode = z.infer<typeof chatErrorCodeSchema>;
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
