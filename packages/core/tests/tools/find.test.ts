import {requireValue} from '../../../shared/tests/helpers.js';
import {describe, expect, it} from 'vitest';
import {findInputSchema} from '../../src/index.js';
import {execution, setupNavigation} from './helpers.js';

describe('find tool', () => {
  it.each([{query: ''}, {query: ' '}, {query: 'x'.repeat(1025)}, {query: 'q', limit: 0}, {query: 'q', limit: 51},
    {query: 'q', maxCharacters: 24_001}, {query: 'q', workspaceRoot: '/other'}])('rejects invalid arguments (case %#)', input => {
    expect(findInputSchema.safeParse(input).success).toBe(false);
  });

  it('runs through the query barrier and returns candidates with freshness', async () => {
    const {reader, query, tools} = setupNavigation();
    const input = {query: 'greet', limit: 5};
    const result = await requireValue(tools.find.execute)(input, execution());
    expect(query).toHaveBeenCalledOnce();
    expect(reader.find).toHaveBeenCalledExactlyOnceWith('greet', input);
    expect(result).toMatchObject({toolName: 'find', status: 'success', output: {context: {matches: []}, freshness: {revision: 2}}});
  });
});
