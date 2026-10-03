import {describe, expect, it} from 'vitest';
import {
  chatRequestSchema,
  toRequestMessage,
  type AssistantMessage,
} from '../../src/index.js';

const messages = [{
  id: 'user-1',
  role: 'user',
  parts: [{type: 'text', text: 'Hello'}],
}];

describe('chat request validation', () => {
  it('rejects unsupported models and reports the model field', () => {
    const result = chatRequestSchema.safeParse({model: 'unknown-model', messages});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['model']);
  });

  it('checks effort against the selected model while allowing provider defaults', () => {
    const model = 'claude-haiku-4-5-20251001';
    expect(chatRequestSchema.safeParse({model, messages}).success).toBe(true);
    const result = chatRequestSchema.safeParse({model, messages, effort: 'high'});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['effort']);
    expect(chatRequestSchema.safeParse({
      model: 'claude-sonnet-5-5', messages, effort: 'high',
    }).success).toBe(true);
  });

  it('rejects assistant-authored content in a user message', () => {
    expect(chatRequestSchema.safeParse({
      model: 'claude-sonnet-5-5',
      messages: [{
        id: 'user-1', role: 'user',
        parts: [{type: 'reasoning', text: 'Private reasoning'}],
      }],
    }).success).toBe(false);
  });
});

describe('toRequestMessage', () => {
  it('keeps assistant text and drops usage without changing the transcript', () => {
    const message: AssistantMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{type: 'text', text: 'Hello back'}],
      usage: {inputTokens: 10, outputTokens: 3},
    };
    expect(toRequestMessage(message)).toEqual({
      id: message.id, role: message.role, parts: message.parts,
    });
    expect(message.usage).toEqual({inputTokens: 10, outputTokens: 3});
  });
});
