import {describe, expect, it} from 'vitest';
import {chatRequestSchema, toolResultSchema, trimToolResult, serializedToolResultBytes, MIN_TRIM_RESULT_BYTES, MAX_TRIM_RECORD_BYTES,
  projectRequestToolResults, olderToolResultIds, type RequestMessage, type ToolResult} from '../../src/index.js';
import {history, readResult, readOutput, OMITTED_MARKER} from './tool-result-fixtures.js';

describe('older tool result projection', () => {
  it('preserves pairs, metadata and frozen originals while removing older body bytes', () => {
    const original = history();
    const snapshot = structuredClone(original);
    const result = readResult();
    Object.freeze(result);
    const trimmed = trimToolResult(result);
    const projected = projectRequestToolResults(original);
    expect(result).toEqual(readResult());
    expect(original).toEqual(snapshot);
    expect(trimmed).toMatchObject({toolCallId: 'old-read', toolName: 'read', status: 'success', output: {
      kind: 'older-tool-result', omitted: true, recovery: {toolName: 'tool_result_read', toolCallId: 'old-read'},
      facts: {filePath: 'src/large.ts', contentHash: 'a'.repeat(64), ranges: [{startLine: 1, endLine: 100}],
        filtering: {reason: 'disabled', incomplete: false}, truncation: {truncated: false, lineTruncated: false}},
    }});
    expect(serializedToolResultBytes(trimmed)).toBeLessThanOrEqual(MAX_TRIM_RECORD_BYTES);
    expect(JSON.stringify(projected.messages)).not.toContain(OMITTED_MARKER);
    expect(projected.messages[1]?.parts[0]).toEqual(original[1]?.parts[0]);
    expect(projected.stats.trimmedResults).toBe(1);
    expect(chatRequestSchema.safeParse({model: 'gpt-6.1-sol', messages: projected.messages}).success).toBe(true);
    expect(projectRequestToolResults(original)).toEqual(projected);
    expect(trimToolResult(trimmed)).toEqual(trimmed);
  });

  it('protects two recent turns and supports disabling projection', () => {
    const messages = history();
    expect(olderToolResultIds(messages.slice(0, 4)).size).toBe(0);
    expect(projectRequestToolResults(messages.slice(0, 4)).stats.trimmedResults).toBe(0);
    expect(projectRequestToolResults(messages, false).messages).toEqual(messages);
  });

  describe('step rule inside a stored turn', () => {
    const step = (id: string, name = 'read') => [
      {type: 'tool-call' as const, call: {toolCallId: id, toolName: name, input: {filePath: 'src/large.ts'}}},
      {type: 'tool-result' as const, result: {...readResult(id), toolName: name}},
    ];
    const turn = (parts: RequestMessage['parts']): RequestMessage[] => [
      {id: 'u1', role: 'user', parts: [{type: 'text', text: 'Inspect'}]},
      {id: 'a1', role: 'assistant', parts},
      {id: 'u2', role: 'user', parts: [{type: 'text', text: 'Next'}]},
    ];

    it('keeps trimmed what the model already saw trimmed, so the next turn does not grow back', () => {
      const parts = ['s1', 's2', 's3', 's4'].flatMap(id => step(id));
      expect([...olderToolResultIds(turn(parts))]).toEqual(['s1', 's2']);
    });

    it('counts parallel calls as one step and ignores recovery reads', () => {
      const parallel = [
        {type: 'tool-call' as const, call: {toolCallId: 'p1', toolName: 'read', input: {}}},
        {type: 'tool-call' as const, call: {toolCallId: 'p2', toolName: 'read', input: {}}},
        {type: 'tool-result' as const, result: readResult('p1')}, {type: 'tool-result' as const, result: readResult('p2')},
      ];
      const parts = [...parallel, ...step('s2'), ...step('r1', 'tool_result_read'), ...step('s3')];
      expect([...olderToolResultIds(turn(parts))].sort()).toEqual(['p1', 'p2']);
    });

    it('uses recorded step numbers so an immediate invalid-call error does not split a step', () => {
      const call = (id: string, stepNumber: number) => ({type: 'tool-call' as const, call: {toolCallId: id, toolName: 'read', input: {}}, step: stepNumber});
      const result = (id: string) => ({type: 'tool-result' as const, result: readResult(id)});
      const invalid = {type: 'tool-result' as const, result: {toolCallId: 'b', toolName: 'read', status: 'error' as const,
        error: {code: 'invalid_input' as const, message: 'The tool call could not be executed.'}}};
      const parts = [call('a', 0), call('b', 0), invalid, call('c', 0), result('a'), result('c'), call('d', 1), result('d')];
      expect(olderToolResultIds(turn(parts)).size).toBe(0);
      expect([...olderToolResultIds(turn([...parts, call('e', 2), result('e')]))].sort()).toEqual(['a', 'b', 'c']);
    });

    it('trims nothing when a turn has no more steps than the protected window', () => {
      expect(olderToolResultIds(turn([...step('s1'), ...step('s2')])).size).toBe(0);
    });
  });

  const unchanged: ToolResult[] = [
    {...readResult(), toolName: 'unknown'},
    {...readResult(), output: {content: 'x'.repeat(20_000)}},
    {...readResult(), output: {...readOutput(), warnings: ['critical warning '.repeat(1000)]}},
    {...readResult(), output: {...readOutput(), ranges: [{startLine: 1, endLine: 2, text: 'small'}]}},
    {toolCallId: 'cancelled', toolName: 'bash', status: 'error', error: {code: 'cancelled', message: 'Execution outcome unknown.'}},
  ];
  it.each(unchanged)('retains unknown, malformed, oversized metadata, small and error outputs (case %#)', result => {
    expect(trimToolResult(result)).toBe(result);
  });

  it('applies the size boundary to serialized UTF-8 bytes', () => {
    const output = {...readOutput(), ranges: [{startLine: 1, endLine: 2, text: ''}]};
    const result: ToolResult = {...readResult(), status: 'success', output};
    const overhead = serializedToolResultBytes(result);
    output.ranges[0].text = 'x'.repeat(MIN_TRIM_RESULT_BYTES - overhead - 1);
    expect(trimToolResult(result)).toBe(result);
    output.ranges[0].text += 'x';
    expect(serializedToolResultBytes(result)).toBe(MIN_TRIM_RESULT_BYTES);
    expect(trimToolResult(result)).not.toBe(result);
  });

  it('keeps command failure and truncation distinct from host execution success', () => {
    const result: ToolResult = {toolCallId: 'test-run', toolName: 'bash', status: 'success', output: {
      workdir: '/workspace', stdout: 'log\n'.repeat(3000), stderr: 'Test assertion failed', exitCode: 1,
      signal: null, termination: 'output_limit', durationMs: 10, truncated: true, untrusted: true,
      warnings: ['Only a bounded part of the log was returned.'],
    }};
    expect(trimToolResult(result)).toMatchObject({status: 'success', output: {
      facts: {exitCode: 1, termination: 'output_limit', truncated: true, warnings: ['Only a bounded part of the log was returned.']},
    }});
    expect(JSON.stringify(trimToolResult(result))).toContain('stderr: Test assertion failed');
  });

  it('lets large recovery pages age across turns while protecting the current recovery', () => {
    const result = toolResultSchema.parse({toolCallId: 'recovery-page', toolName: 'tool_result_read', status: 'success', output: {
      toolCallId: 'old-read', contentHash: 'c'.repeat(64), offset: 0, nextOffset: 10000, totalCharacters: 20000,
      originalBytes: 20000, content: 'exact historical JSON '.repeat(500), untrusted: true, coverage: 'Original output was truncated.',
    }});
    expect(projectRequestToolResults(history(result).slice(0, 4)).stats.trimmedResults).toBe(0);
    expect(projectRequestToolResults(history(result)).stats.trimmedResults).toBe(1);
    expect(trimToolResult(result)).toMatchObject({output: {facts: {
      toolCallId: 'old-read', offset: 0, nextOffset: 10000, coverage: 'Original output was truncated.',
    }}});
  });

  it('keeps future graph fields as data without interpreting them as source', () => {
    const result = toolResultSchema.parse({toolCallId: 'future', toolName: 'find', status: 'success', output: {
      context: {query: 'future', matches: [], truncated: false, coverage: 'Indexed scope',
        source: 'not a source record', snippets: ['future output '.repeat(1000)]}, freshness: {revision: 1},
    }});
    expect(trimToolResult(result)).toBe(result);
  });

  it.each(['grep', 'glob', 'git_diff', 'web_fetch'])('retains original search/network coverage for %s', toolName => {
    const common = {untrusted: true, warnings: [], filtering: {status: 'partial', incomplete: true},
      truncated: true, incomplete: true, coverage: 'Only requested scope; not exhaustive.'};
    const outputs = new Map([
      ['grep', {...common, pattern: 'needle', path: 'src', matches: Array.from({length: 150}, (_, index) =>
        ({filePath: `src/file${index}.ts`, line: index + 1, column: 1, text: 'needle'.repeat(50), textStartColumn: 1, textTruncated: true}))}],
      ['glob', {...common, pattern: '*.ts', path: 'src', files: Array.from({length: 1500}, (_, index) => `src/file${index}.ts`)}],
      ['git_diff', {...common, entries: ['diff --git a/a b/a\n' + '+edited\n'.repeat(1500)]}],
      ['web_fetch', {...common, requestedUrl: 'https://example.com/a', finalUrl: 'https://example.com/b', status: 200,
        contentType: 'text/html', format: 'html', content: 'section\n'.repeat(1500),
        truncation: {truncated: true, originalCharacters: 20000, selectedCharacters: 15000, returnedCharacters: 10500}}],
    ]);
    const result = toolResultSchema.parse({toolCallId: 'query', toolName, status: 'success', output: outputs.get(toolName)});
    const validated = chatRequestSchema.parse({model: 'gpt-6.1-sol', messages: history(result)});
    expect(projectRequestToolResults(validated.messages).stats.trimmedResults).toBe(1);
    expect(trimToolResult(result)).toMatchObject({output: {facts: {filtering: {status: 'partial', incomplete: true}}}});
  });

  it.each(['explore', 'find', 'inspect', 'trace'])('preserves verified graph references and freshness for %s', toolName => {
    const symbol = {id: 'large', name: 'large', qualifiedName: 'large', kind: 'function', filePath: 'src/large.ts',
      startLine: 1, endLine: 100, reference: {workspaceId: 'b'.repeat(64), symbolId: 'large', filePath: 'src/large.ts', contentHash: 'a'.repeat(64)},
      metadataTruncated: false};
    const symbols = Array.from({length: 50}, (_, index) => ({...symbol, id: `symbol-${index}`}));
    const coverage = {truncated: true, coverage: 'Indexed scope only; source may change.'};
    const contexts = new Map([
      ['explore', {...coverage, query: 'large', summary: 'Found candidate symbols', symbols, relationships: [], relatedFiles: ['src/large.ts'],
        snippets: [{symbolId: 'large', filePath: 'src/large.ts', startLine: 1, endLine: 100,
          contentHash: 'a'.repeat(64), truncated: true, text: readOutput().ranges[0].text}]}],
      ['find', {...coverage, query: 'large', matches: symbols.map(value => ({symbol: value, score: 1}))}],
      ['inspect', {...coverage, type: 'symbol', symbol,
        source: {startLine: 1, endLine: 100, contentHash: 'a'.repeat(64), truncated: true, text: readOutput().ranges[0].text}}],
      ['trace', {...coverage, target: symbol, direction: 'callers', depth: 1, symbols, relationships: []}],
    ]);
    const result = toolResultSchema.parse({toolCallId: 'graph-call', toolName, status: 'success', output: {
      context: contexts.get(toolName), freshness: {epoch: 'snapshot', revision: 3, reconciledAt: 10},
    }});
    const snapshot = structuredClone(result);
    const trimmed = trimToolResult(result);
    expect(trimmed).not.toEqual(result);
    expect(result).toEqual(snapshot);
    expect(serializedToolResultBytes(trimmed)).toBeLessThanOrEqual(MAX_TRIM_RECORD_BYTES);
    expect(trimmed).toMatchObject({output: {facts: {freshness: {epoch: 'snapshot', revision: 3},
      context: {truncated: true, coverage: 'Indexed scope only; source may change.'}}}});
    expect(JSON.stringify(trimmed)).toContain('"symbolId":"large"');
    expect(JSON.stringify(trimmed)).not.toContain(OMITTED_MARKER);
  });
});
