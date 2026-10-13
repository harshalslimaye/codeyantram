import {Buffer} from 'node:buffer';
import {describe, expect, it} from 'vitest';
import {ToolResultArchive, toolResultReadInputSchema} from '../../src/chat/tool-result-archive.js';
import {toModelMessages} from '../../src/chat/messages.js';
import {createToolExecutor} from '../../src/tools/execution.js';
import {history, readResult, readOutput} from '../../../shared/tests/chat/tool-result-fixtures.js';
import {requireValue} from '../../../shared/tests/helpers.js';

describe('exact historical output recovery', () => {
  it('recovers complete escaped Unicode JSON over bounded pages after originals change', () => {
    const original = readResult();
    if (original.status !== 'success') throw new Error('Expected success fixture.');
    original.output = {...readOutput(), ranges: [{startLine: 1, endLine: 100, text: '😀\\\t"\n'.repeat(8000)}]};
    const expected = JSON.stringify(original);
    const archive = new ToolResultArchive();
    archive.record(toModelMessages({messages: history(original)}));
    original.output = {modified: true};
    let offset = 0;
    let recovered = '';
    const hashes = new Set<string>();
    for (;;) {
      const page = archive.read({toolCallId: 'old-read', offset});
      expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(24_576);
      expect(page.offset).toBe(offset);
      expect(page.sourceLimitations).toEqual({truncated: false, lineTruncated: false, incomplete: null, filteringIncomplete: false});
      recovered += page.content;
      hashes.add(page.contentHash);
      if (page.nextOffset === null) break;
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset;
    }
    expect(recovered).toBe(expected);
    expect(hashes.size).toBe(1);
  });

  it('rejects unknown IDs, invalid coordinates and mid-surrogate offsets', () => {
    const archive = new ToolResultArchive();
    const original = {...readResult(), status: 'success' as const, output: {value: '😀'}};
    const text = JSON.stringify(original);
    archive.record(toModelMessages({messages: history(original)}));
    expect(() => archive.read({toolCallId: 'missing'})).toThrow('unavailable');
    expect(() => archive.read({toolCallId: 'old-read', offset: text.length})).toThrow('offset');
    expect(() => archive.read({toolCallId: 'old-read', offset: text.indexOf('😀') + 1})).toThrow('Unicode');
    expect(archive.read({toolCallId: 'old-read', offset: text.indexOf('😀'), length: 1}).content).toBe('😀');
    expect(toolResultReadInputSchema.safeParse({toolCallId: 'old-read', offset: -1}).success).toBe(false);
    expect(toolResultReadInputSchema.safeParse({toolCallId: 'old-read', length: 24_577}).success).toBe(false);
    expect(toolResultReadInputSchema.safeParse({toolCallId: 'old-read', path: '/other/session'}).success).toBe(false);
  });

  it('shares execution limits and cancellation without executing the original operation', async () => {
    const archive = new ToolResultArchive();
    archive.record(toModelMessages({messages: history()}));
    const execute = requireValue(archive.createTool(createToolExecutor()).execute);
    const signal = AbortSignal.abort();
    expect(await execute({toolCallId: 'old-read'}, {toolCallId: 'cancelled', messages: [], context: {}, abortSignal: signal}))
      .toMatchObject({status: 'error', error: {code: 'cancelled'}});
    for (let index = 1; index < 20; index++) await execute({toolCallId: 'old-read'}, {toolCallId: `recovery-${index}`, messages: [], context: {}});
    expect(await execute({toolCallId: 'old-read'}, {toolCallId: 'over-limit', messages: [], context: {}}))
      .toMatchObject({status: 'error', error: {code: 'tool_limit'}});
  });
});
