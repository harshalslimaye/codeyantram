import {z} from 'zod';
import {findSupportedChatModel, modelSupportsEffort} from '../providers/index.js';
import {effortLevelSchema} from '../providers/schemas.js';
import type {ChatMessage, RequestMessage} from './types.js';

export const chatModelIdSchema = z.string().min(1);

export const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const messagePartSchema = textPartSchema;
export const messagePartsSchema = z.array(messagePartSchema);

// Cache counts are a breakdown of inputTokens, not additional input tokens.
export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
});

export const userMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal('user'),
  parts: z.array(textPartSchema).min(1),
});

// An assistant message can have no parts while waiting for its first delta.
export const assistantMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  parts: messagePartsSchema,
  usage: tokenUsageSchema.optional(),
});

export const chatMessageSchema = z.discriminatedUnion('role', [
  userMessageSchema,
  assistantMessageSchema,
]);

export const requestAssistantMessageSchema = assistantMessageSchema.omit({usage: true});

export const requestMessageSchema = z.discriminatedUnion('role', [
  userMessageSchema,
  requestAssistantMessageSchema,
]);

/** Selects conversation fields without replaying response metadata. */
export function toRequestMessage(message: ChatMessage): RequestMessage {
  return {id: message.id, role: message.role, parts: message.parts};
}

export const chatRequestSchema = z.object({
  model: chatModelIdSchema,
  messages: z.array(requestMessageSchema).min(1),
  effort: effortLevelSchema.optional(),
}).superRefine((request, ctx) => {
  const model = findSupportedChatModel(request.model);
  if (!model) {
    ctx.addIssue({
      code: 'custom',
      message: 'This model is not supported',
      path: ['model'],
    });
    return;
  }

  if (request.effort !== undefined && !modelSupportsEffort(model, request.effort)) {
    ctx.addIssue({
      code: 'custom',
      message: 'This model does not support the requested effort level',
      path: ['effort'],
    });
  }
});

export const chatErrorCodeSchema = z.enum([
  'invalid_request',
  'missing_credentials',
  'rate_limited',
  'provider_error',
  'internal_error',
]);

// SSE carries one JSON event per data frame. Successful turns end with done;
// failed turns end with error. Clients track explicit cancellation separately
// so an unexpected disconnect can be reported as an interrupted response.
export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    messageId: z.string().min(1),
  }),
  z.object({
    type: z.literal('text-delta'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    durationMs: z.number().nonnegative(),
    usage: tokenUsageSchema.optional(),
  }),
  z.object({
    type: z.literal('error'),
    code: chatErrorCodeSchema,
    message: z.string(),
  }),
]);
