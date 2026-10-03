import {describe, expect, it} from 'vitest';
import {
  MAX_SUMMARY_CHARACTERS,
  compactMessageSchema,
  compactRequestSchema,
  compactStreamEventSchema,
  contextSummarySchema,
  type CompactMessage,
  type CompactRequest,
  type CompactStreamEvent,
} from '../../src/index.js';

const userMessage: CompactMessage = {
  id: 'user-1', role: 'user', parts: [{type: 'text', text: 'Implement /compact.'}],
};
const assistantMessage: CompactMessage = {
  id: 'assistant-1', role: 'assistant', parts: [{type: 'text', text: 'The schemas are complete.'}],
};
const request: CompactRequest = {
  model: 'gpt-6.1-sol', messages: [userMessage, assistantMessage],
};

describe('conversation summary validation', () => {
  it('preserves summary text exactly and accepts the character limit', () => {
    const summary = '  Objective: implement /compact.\nKeep recent turns.  ';
    expect(contextSummarySchema.parse(summary)).toBe(summary);
    expect(contextSummarySchema.parse('x'.repeat(MAX_SUMMARY_CHARACTERS)))
      .toHaveLength(MAX_SUMMARY_CHARACTERS);
  });

  it.each(['', ' \n\t ', 'x'.repeat(MAX_SUMMARY_CHARACTERS + 1), null, 42])(
    'rejects a blank, overlong, or non-string summary (case %#)', summary => {
      expect(contextSummarySchema.safeParse(summary).success).toBe(false);
    },
  );
});

describe('compact request validation', () => {
  it.each(['gpt-6.1-sol', 'claude-sonnet-5-5', 'gemini-3.8-flash'])(
    'accepts a first compaction and a summary refresh with %s', model => {
      const first = {...request, model};
      expect(compactRequestSchema.parse(first)).toEqual(first);
      const refresh = {...first, previousSummary: 'Keep user constraints and pending work.'};
      expect(compactRequestSchema.parse(refresh)).toEqual(refresh);
    },
  );

  it.each(['complete', 'cancelled', 'failed'] as const)(
    'retains the assistant response status %s', status => {
      expect(compactMessageSchema.parse({...assistantMessage, status}))
        .toEqual({...assistantMessage, status});
      expect(compactMessageSchema.safeParse({...userMessage, status}).success).toBe(false);
    },
  );

  it.each([
    {...assistantMessage, status: 'streaming'},
    {...assistantMessage, status: 'unknown'},
    {...assistantMessage, status: null},
    {...assistantMessage, parts: []},
    {...assistantMessage, parts: [{type: 'text', text: ''}]},
    {...userMessage, parts: [{type: 'text', text: ' \n '}]},
    {...userMessage, id: ''},
    {...userMessage, role: 'system'},
    {...userMessage, parts: [{type: 'reasoning', text: 'Private reasoning'}]},
  ])('rejects unusable prefix messages (case %#)', message => {
    expect(compactRequestSchema.safeParse({...request, messages: [message]}).success).toBe(false);
  });

  it('allows empty text parts alongside meaningful content without changing the source', () => {
    const message = {...userMessage, parts: [{type: 'text', text: ''}, ...userMessage.parts]};
    expect(compactMessageSchema.parse(message)).toEqual(message);
  });

  it('reports an unsupported model at the model field', () => {
    const result = compactRequestSchema.safeParse({...request, model: 'unknown-model'});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['model']);
  });

  it.each([
    {...request, model: ''},
    {...request, messages: []},
    {...request, messages: undefined},
    {...request, previousSummary: ''},
    {...request, previousSummary: ' \n\t '},
    {...request, previousSummary: 'x'.repeat(MAX_SUMMARY_CHARACTERS + 1)},
    {...request, previousSummary: null},
  ])('rejects incomplete or invalid requests (case %#)', input => {
    expect(compactRequestSchema.safeParse(input).success).toBe(false);
  });

  it('excludes response metadata and client generation settings from parsed requests', () => {
    const input = {
      ...request,
      messages: [userMessage, {...assistantMessage, usage: {inputTokens: 10}, durationMs: 20}],
      effort: 'max', maxOutputTokens: 100_000, providerOptions: {anthropic: {effort: 'max'}},
    };
    expect(compactRequestSchema.parse(input)).toEqual(request);
    expect(input.messages[1]).toHaveProperty('usage');
  });
});

describe('compact stream event validation', () => {
  it('accepts start, complete summaries with optional usage, and shared errors', () => {
    const events: CompactStreamEvent[] = [
      {type: 'start'},
      {type: 'done', summary: 'Current task: /compact.', durationMs: 0},
      {
        type: 'done', summary: 'Current task: /compact.', durationMs: 20,
        usage: {inputTokens: 100, outputTokens: 10, totalTokens: 110, cacheReadTokens: 50},
      },
      {type: 'error', code: 'compaction_failed', message: 'The summary was incomplete.'},
      {type: 'error', code: 'missing_credentials', message: 'Configure an API key.'},
    ];
    for (const event of events) expect(compactStreamEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    {type: 'text-delta', text: 'An incomplete summary'},
    {type: 'done', durationMs: 1},
    {type: 'done', summary: '', durationMs: 1},
    {type: 'done', summary: ' \n ', durationMs: 1},
    {type: 'done', summary: 'x'.repeat(MAX_SUMMARY_CHARACTERS + 1), durationMs: 1},
    {type: 'done', summary: 'Valid summary', durationMs: -1},
    {type: 'done', summary: 'Valid summary', durationMs: Infinity},
    {type: 'done', summary: 'Valid summary', durationMs: 1, usage: {inputTokens: -1}},
    {type: 'error', code: 'unknown', message: 'Invalid error'},
  ])('rejects partial or malformed results (case %#)', event => {
    expect(compactStreamEventSchema.safeParse(event).success).toBe(false);
  });
});
