import {describe, expect, it} from 'vitest';
import {
  chatRequestSchema,
  chatStreamEventSchema,
  toolCallSchema,
  toolDefinitionSchema,
  toolErrorCodeSchema,
  toolInputSchema,
  toolMessagePartSchema,
  toolNameSchema,
  toolOutputSchema,
  toolResultSchema,
  toolStreamEventSchema,
  type ToolCall,
  type ToolResult,
  type ToolStreamEvent,
} from '../../src/index.js';

const call: ToolCall = {
  toolCallId: 'call-1', toolName: 'read_file', input: {path: 'src/index.ts'},
};
const success: ToolResult = {
  toolCallId: call.toolCallId, toolName: call.toolName, status: 'success',
  output: {content: '  export {};\n', truncated: false},
};
const failure: ToolResult = {
  toolCallId: call.toolCallId, toolName: call.toolName, status: 'error',
  error: {code: 'execution_failed', message: 'The file could not be read.'},
};

describe('tool definitions and identifiers', () => {
  it('preserves descriptions and accepts stable identifiers', () => {
    const definition = {name: 'read_file', description: '  Read a workspace file.\n'};
    expect(toolDefinitionSchema.parse(definition)).toEqual(definition);
    expect(toolNameSchema.parse('a'.repeat(64))).toHaveLength(64);
    expect(toolNameSchema.parse('_ReadFile2')).toBe('_ReadFile2');
  });

  it.each(['', ' ', 'read file', '../read_file', 'read-file', '1read_file', 'a'.repeat(65)])(
    'rejects an invalid tool identifier (case %#)', name => {
      expect(toolDefinitionSchema.safeParse({name, description: 'Read a file.'}).success).toBe(false);
      expect(toolCallSchema.safeParse({...call, toolName: name}).success).toBe(false);
      expect(toolResultSchema.safeParse({...success, toolName: name}).success).toBe(false);
    },
  );

  it.each(['', ' \n\t ', null, 42])('rejects an unusable description (case %#)', description => {
    expect(toolDefinitionSchema.safeParse({name: 'read_file', description}).success).toBe(false);
  });
});

describe('tool wire data', () => {
  it('preserves nested JSON arguments without interpreting tool-specific fields', () => {
    const input = {
      path: '  src/नमस्ते.ts  ', range: {start: 1, end: null},
      options: [true, false, {labels: ['a', 'b']}],
    };
    expect(toolInputSchema.parse(input)).toEqual(input);
    expect(toolCallSchema.parse({...call, input})).toEqual({...call, input});
    expect(toolInputSchema.parse({})).toEqual({});
  });

  it.each([null, [], 'src/index.ts', 42, undefined])(
    'requires object arguments (case %#)', input => {
      expect(toolCallSchema.safeParse({...call, input}).success).toBe(false);
    },
  );

  it.each([undefined, NaN, Infinity, -Infinity, 1n, () => {}, Symbol('value'), new Date()])(
    'rejects values that cannot round-trip as JSON, including nested values (case %#)', value => {
      expect(toolOutputSchema.safeParse(value).success).toBe(false);
      expect(toolInputSchema.safeParse({nested: [{value}]}).success).toBe(false);
      expect(toolResultSchema.safeParse({...success, output: {nested: [value]}}).success).toBe(false);
    },
  );

  it.each(['file contents', 0, true, null, [], {content: '', lines: [1, 2]}])(
    'accepts JSON output without inventing a per-tool output shape (case %#)', output => {
      expect(toolResultSchema.parse({...success, output})).toEqual({...success, output});
    },
  );
});

describe('tool calls and results', () => {
  it.each(['', ' \n\t ', null, 42])('requires a usable correlation ID (case %#)', toolCallId => {
    expect(toolCallSchema.safeParse({...call, toolCallId}).success).toBe(false);
    expect(toolResultSchema.safeParse({...success, toolCallId}).success).toBe(false);
    expect(toolResultSchema.safeParse({...failure, toolCallId}).success).toBe(false);
  });

  it('requires a call input and rejects unrecognized envelope fields', () => {
    const {input: _input, ...withoutInput} = call;
    expect(toolCallSchema.safeParse(withoutInput).success).toBe(false);
    expect(toolCallSchema.safeParse({...call, execute: true}).success).toBe(false);
  });

  it('keeps successful output and structured execution errors mutually exclusive', () => {
    expect(toolResultSchema.parse(success)).toEqual(success);
    expect(toolResultSchema.parse(failure)).toEqual(failure);
    const invalid = [
      {...success, output: undefined},
      {...failure, error: undefined},
      {...success, error: failure.error},
      {...failure, output: success.output},
      {...success, status: 'pending'},
      {...failure, error: {code: 'unknown', message: 'Failed.'}},
      {...failure, error: {code: 'execution_failed', message: ' \n '}},
      {...failure, error: {...failure.error, stack: 'Internal details'}},
    ];
    for (const input of invalid) expect(toolResultSchema.safeParse(input).success).toBe(false);
  });

  it('represents lookup, validation, authorization, execution, timeout, and cancellation failures', () => {
    for (const code of toolErrorCodeSchema.options) {
      const result = {...failure, error: {code, message: 'Tool execution did not complete.'}};
      expect(toolResultSchema.parse(result)).toEqual(result);
    }
  });
});

describe('tool message parts and stream events', () => {
  const events: ToolStreamEvent[] = [
    {type: 'tool-call', call},
    {type: 'tool-result', result: success},
    {type: 'tool-result', result: failure},
  ];

  it('round-trips complete calls/results through JSON as both events and stored parts', () => {
    const wire = JSON.parse(JSON.stringify(events));
    expect(wire.map((event: unknown) => toolStreamEventSchema.parse(event))).toEqual(events);
    expect(wire.map((event: unknown) => toolMessagePartSchema.parse(event))).toEqual(events);
    expect(events[0]).toMatchObject({call: {toolCallId: 'call-1'}});
    expect(events[1]).toMatchObject({result: {toolCallId: 'call-1'}});
  });

  it.each([
    {type: 'tool-call'},
    {type: 'tool-result'},
    {type: 'tool-call', result: success},
    {type: 'tool-result', call},
    {type: 'tool-result', result: {...success, output: undefined}},
    {type: 'tool-input-delta', text: '{'},
    {type: 'tool-call', call, result: success},
  ])('rejects incomplete or mismatched envelopes (case %#)', event => {
    expect(toolStreamEventSchema.safeParse(event).success).toBe(false);
    expect(toolMessagePartSchema.safeParse(event).success).toBe(false);
  });

  it('accepts complete assistant call/result pairs and events while rejecting user tools and orphaned replay', () => {
    for (const part of events) {
      expect(chatStreamEventSchema.safeParse(part).success).toBe(true);
      for (const role of ['user', 'assistant']) {
        expect(chatRequestSchema.safeParse({
          model: 'gpt-6.1-sol', messages: [{id: 'message-1', role, parts: [part]}],
        }).success).toBe(false);
      }
    }
    expect(chatRequestSchema.safeParse({model: 'gpt-6.1-sol', messages: [
      {id: 'a1', role: 'assistant', parts: events.slice(0, 2)},
    ]}).success).toBe(true);
    expect(chatRequestSchema.safeParse({model: 'gpt-6.1-sol', messages: [
      {id: 'a1', role: 'assistant', parts: [events[0], events[1], events[1]]},
    ]}).success).toBe(false);
  });
});
