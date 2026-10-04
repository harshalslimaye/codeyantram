import {z} from 'zod';
import {findSupportedChatModel} from '../providers/types/index.js';
import {
  chatErrorCodeSchema,
  chatModelIdSchema,
  contextSummarySchema,
  requestAssistantMessageSchema,
  textPartSchema,
  tokenUsageSchema,
  userMessageSchema,
} from './schemas.js';

export const compactAssistantStatusSchema = z.enum(['complete', 'cancelled', 'failed']);

export const compactMessageSchema = z.discriminatedUnion('role', [
  // Status describes an assistant response; reject it on user-authored messages.
  userMessageSchema.extend({status: z.never().optional()}),
  requestAssistantMessageSchema.extend({
    parts: z.array(textPartSchema).min(1),
    status: compactAssistantStatusSchema.optional(),
  }),
]).refine(message => message.parts.some(part => part.text.trim().length > 0), {
  message: 'A compaction message must contain nonblank text',
  path: ['parts'],
});

/** Only the newly selected prefix is sent, together with any previous summary. */
export const compactRequestSchema = z.object({
  model: chatModelIdSchema,
  previousSummary: contextSummarySchema.optional(),
  messages: z.array(compactMessageSchema).min(1),
}).superRefine((request, ctx) => {
  if (!findSupportedChatModel(request.model)) {
    ctx.addIssue({
      code: 'custom',
      message: 'This model is not supported',
      path: ['model'],
    });
  }
});

// A summary is usable only after a complete done event; no partial text is exposed.
export const compactStreamEventSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('start')}),
  z.object({
    type: z.literal('done'),
    summary: contextSummarySchema,
    durationMs: z.number().nonnegative(),
    usage: tokenUsageSchema.optional(),
  }),
  z.object({
    type: z.literal('error'),
    code: chatErrorCodeSchema,
    message: z.string(),
  }),
]);

export type CompactAssistantStatus = z.infer<typeof compactAssistantStatusSchema>;
export type CompactMessage = z.infer<typeof compactMessageSchema>;
export type CompactRequest = z.infer<typeof compactRequestSchema>;
export type CompactStreamEvent = z.infer<typeof compactStreamEventSchema>;
