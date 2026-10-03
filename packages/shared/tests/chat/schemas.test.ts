import {describe, expect, it} from 'vitest';
import {
  chatRequestSchema,
  chatStreamEventSchema,
  MAX_SUMMARY_CHARACTERS,
  toRequestMessage,
  type AssistantMessage,
} from '../../src/index.js';

const messages = [{
  id: 'user-1',
  role: 'user',
  parts: [{type: 'text', text: 'Hello'}],
}];

describe('chat request validation', () => {
  it('preserves existing requests and accepts an optional historical summary', () => {
    const request = {model: 'gpt-6.1-sol', messages};
    expect(chatRequestSchema.parse(request)).toEqual(request);
    expect(chatRequestSchema.parse(request)).not.toHaveProperty('contextSummary');
    const withSummary = {...request, contextSummary: '  Prior task decisions.\nKeep recent turns.  '};
    expect(chatRequestSchema.parse(withSummary)).toEqual(withSummary);
  });

  it.each(['', ' \n\t ', 'x'.repeat(MAX_SUMMARY_CHARACTERS + 1), null])(
    'rejects invalid historical summaries (case %#)', contextSummary => {
      const result = chatRequestSchema.safeParse({model: 'gpt-6.1-sol', messages, contextSummary});
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(['contextSummary']);
    },
  );

  it('requires a conversation message even when a summary is present', () => {
    expect(chatRequestSchema.safeParse({
      model: 'gpt-6.1-sol', contextSummary: 'Prior task decisions.', messages: [],
    }).success).toBe(false);
  });

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

describe('chat stream error compatibility', () => {
  it('accepts the compaction failure error category', () => {
    const event = {type: 'error', code: 'compaction_failed', message: 'The summary was incomplete.'};
    expect(chatStreamEventSchema.parse(event)).toEqual(event);
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
