import {describe, expect, it} from 'vitest';
import {applyHunks} from '../../../src/tools/apply-patch/hunks.js';
import {parsePatch} from '../../../src/tools/apply-patch/parser.js';

describe('exact patch hunks', () => {
  it('preserves CRLF, BOM, and missing terminal newlines', () => {
    expect(applyHunks('\ufeffheader\r\nold\r\n', ['@@', '-old', '+new'])).toBe('\ufeffheader\r\nnew\r\n');
    expect(applyHunks('\ufeffold\n', ['@@', '-old', '+new'])).toBe('\ufeffnew\n');
    expect(applyHunks('old', ['@@', '-old', '+new'])).toBe('new');
    expect(applyHunks('old\n', ['@@', '-old', '+new'])).toBe('new\n');
  });

  it('applies ordered hunks with unique anchors and EOF context', () => {
    expect(applyHunks('first\nold\nsecond\nold\n', ['@@ first', '-old', '+new', ' second', '@@', '-old', '+last', '*** End of File']))
      .toBe('first\nnew\nsecond\nlast\n');
    expect(applyHunks('old\nold\n', ['@@', '-old', '+new', '*** End of File'])).toBe('old\nnew\n');
    expect(applyHunks('one\n', ['@@', ' one', '+two'])).toBe('one\ntwo\n');
  });

  it.each([
    ['old\nold\n', ['@@', '-old', '+new']], ['old \n', ['@@', '-old', '+new']],
    ['other\n', ['@@', '-old', '+new']], ['old\n', ['@@', '+new']],
    ['old\n', ['@@', ' old']], ['old\n', ['@@', '-old', '+new', '*** End of File', '+extra']],
    ['anchor\nold\nanchor\nold\n', ['@@ anchor', '-old', '+new']],
    ['old\r\nother\n', ['@@', '-old', '+new']], ['', ['@@', '-', '+new']],
  ])('refuses fuzzy, ambiguous, no-op, or malformed hunks for %j', (text, lines) => {
    expect(() => applyHunks(text as string, lines as string[])).toThrow(/context|Begin|line endings/);
  });

  it('does not overflow the call stack on very many source lines', () => {
    const text = 'x\n'.repeat(200_000) + 'old\n';
    expect(applyHunks(text, ['@@', '-old', '+new'])).toBe('x\n'.repeat(200_000) + 'new\n');
  });

  it('validates patch delimiters and operation budgets', () => {
    expect(() => parsePatch('*** Begin Patch\n*** End Patch')).toThrow('Use Begin/End Patch');
    expect(() => parsePatch('*** Begin Patch\n*** Add File: file.ts\n+new')).toThrow('Use Begin/End Patch');
    const many = Array.from({length: 17}, (_, position) => `*** Add File: ${position}.ts\n+new`);
    expect(() => parsePatch(['*** Begin Patch', ...many, '*** End Patch'].join('\n'))).toThrow('Use Begin/End Patch');
  });
});
