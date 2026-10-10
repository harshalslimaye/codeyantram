import {requireValue} from '../../../shared/tests/helpers.js';
import {describe, expect, it} from 'vitest';
import {traceInputSchema} from '../../src/index.js';
import {execution, reference, setupNavigation} from './helpers.js';

describe('trace tool', () => {
  it.each([{reference, direction: 'impact'}, {reference, direction: 'callers', depth: 4}, {reference, direction: 'callees', limit: 51},
    {reference, direction: 'callers', maxCharacters: 1024}, {reference: {...reference, contentHash: 'invalid'}, direction: 'callers'},
    {reference, direction: 'callers', databasePath: '/other.db'}])('rejects invalid or unbounded arguments (case %#)', input => {
    expect(traceInputSchema.safeParse(input).success).toBe(false);
  });

  it('passes direction and bounds through the synchronized reader', async () => {
    const {reader, tools} = setupNavigation();
    const input = {reference, direction: 'callers' as const, depth: 2, limit: 5};
    expect(await requireValue(tools.trace.execute)(input, execution())).toMatchObject({toolName: 'trace', status: 'success', output: {context: {symbols: []}, freshness: {revision: 2}}});
    expect(reader.trace).toHaveBeenCalledExactlyOnceWith(reference, input);
  });
});
