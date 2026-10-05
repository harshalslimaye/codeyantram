import {describe, expect, it} from 'vitest';
import {navigationFilePathSchema, symbolReferenceSchema} from '../../src/index.js';

describe('navigation references', () => {
  const reference = {workspaceId: 'a'.repeat(64), symbolId: 'function:123', filePath: 'src/नमस्ते.ts', contentHash: 'b'.repeat(64)};
  it('round-trips content-backed references with portable relative paths', () => {
    expect(symbolReferenceSchema.parse(JSON.parse(JSON.stringify(reference)))).toEqual(reference);
  });
  it.each(['', '../outside.ts', '/absolute.ts', 'C:/drive.ts', 'src\\file.ts', 'src//file.ts', 'src/./file.ts', 'src/../file.ts', 'src/file\0.ts'])
    ('rejects unsafe or noncanonical paths (case %#)', filePath => {
      expect(navigationFilePathSchema.safeParse(filePath).success).toBe(false);
    });
  it.each([{...reference, workspaceId: 'wrong'}, {...reference, contentHash: 'wrong'}, {...reference, symbolId: ''},
    {...reference, databasePath: '/global/db.sqlite'}])('rejects incomplete or extended references (case %#)', value => {
      expect(symbolReferenceSchema.safeParse(value).success).toBe(false);
    });
});
