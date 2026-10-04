import {z} from 'zod';

// Tool names are stable identifiers, separate from their human-readable descriptions.
export const toolNameSchema = z.string().min(1).max(64).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
export const toolCallIdSchema = z.string().refine(id => id.trim().length > 0, {
  message: 'A tool call ID must contain nonblank text',
});

/** Shared metadata; per-tool argument schemas and executors belong with the implementation. */
export const toolDefinitionSchema = z.strictObject({
  name: toolNameSchema,
  description: z.string().refine(description => description.trim().length > 0, {
    message: 'A tool description must contain nonblank text',
  }),
});

// Wire data must survive JSON/SSE round trips. Each tool validates its own input fields.
export const toolInputSchema = z.record(z.string(), z.json());
export const toolOutputSchema = z.json();

export const toolCallSchema = z.strictObject({
  toolCallId: toolCallIdSchema,
  toolName: toolNameSchema,
  input: toolInputSchema,
});

export const toolErrorCodeSchema = z.enum([
  'tool_not_found',
  'invalid_input',
  'permission_denied',
  'execution_failed',
  'timeout',
  'cancelled',
]);

export const toolErrorSchema = z.strictObject({
  code: toolErrorCodeSchema,
  message: z.string().refine(message => message.trim().length > 0, {
    message: 'A tool error must contain a nonblank message',
  }),
});

/** An execution failure is a tool result, separate from a turn-ending chat error. */
export const toolResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    toolCallId: toolCallIdSchema,
    toolName: toolNameSchema,
    status: z.literal('success'),
    output: toolOutputSchema,
  }),
  z.strictObject({
    toolCallId: toolCallIdSchema,
    toolName: toolNameSchema,
    status: z.literal('error'),
    error: toolErrorSchema,
  }),
]);

export const toolCallPartSchema = z.strictObject({
  type: z.literal('tool-call'),
  call: toolCallSchema,
});

export const toolResultPartSchema = z.strictObject({
  type: z.literal('tool-result'),
  result: toolResultSchema,
});

// These contracts are exported separately until chat can execute and replay tools.
export const toolMessagePartSchema = z.discriminatedUnion('type', [
  toolCallPartSchema,
  toolResultPartSchema,
]);

/** Events carry the same complete call/result payloads as stored message parts. */
export const toolStreamEventSchema = toolMessagePartSchema;
