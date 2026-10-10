import {requireValue} from '../../../shared/tests/helpers.js';
import {describe, expect, it} from 'vitest';
import {GraphNavigationError} from '@codeyantram/graph';
import {inspectInputSchema} from '../../src/index.js';
import {execution, reference, setupNavigation} from './helpers.js';

describe('inspect tool', () => {
  it.each([{}, {reference, filePath: 'src/helper.ts'}, {reference: {symbolId: 'bare-id'}}, {filePath: '../outside.ts'},
    {filePath: '/absolute.ts'}, {filePath: 'C:\\outside.ts'}, {filePath: 'src/./helper.ts'}, {filePath: 'src/helper.ts', root: '/other'}])
    ('requires exactly one valid workspace-bound target (case %#)', input => {
      expect(inspectInputSchema.safeParse(input).success).toBe(false);
    });

  it('inspects a reference or indexed file outline through the query barrier', async () => {
    const {reader, tools} = setupNavigation();
    await requireValue(tools.inspect.execute)({reference, maxCharacters: 2048}, execution());
    expect(reader.inspect).toHaveBeenLastCalledWith({reference}, {reference, maxCharacters: 2048});
    await requireValue(tools.inspect.execute)({filePath: 'src/helper.ts', limit: 5}, execution('file-call'));
    expect(reader.inspect).toHaveBeenLastCalledWith({filePath: 'src/helper.ts'}, {filePath: 'src/helper.ts', limit: 5});
  });

  it('returns stale references as recoverable errors without choosing another symbol', async () => {
    const {reader, tools} = setupNavigation();
    reader.inspect.mockRejectedValueOnce(new GraphNavigationError('stale_reference', 'The referenced file changed. Run find again.'));
    expect(await requireValue(tools.inspect.execute)({reference}, execution())).toMatchObject({toolName: 'inspect', status: 'error', error: {code: 'stale_reference'}});
    expect(reader.find).not.toHaveBeenCalled();
  });
});
