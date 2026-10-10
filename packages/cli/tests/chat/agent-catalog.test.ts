import {describe, expect, it, vi} from 'vitest';
import {loadAgentMetadata} from '../../src/chat/agent-catalog.js';
import {requestUrl} from '../../../shared/tests/helpers.js';

const agent = {id: 'ask', name: 'Ask', description: 'Read code.', source: 'builtin',
  approval: 'none', tools: ['read'], available: true};

describe('agent metadata client', () => {
  it('reads and validates the private server response', async () => {
    const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(Response.json([agent]));
    expect(await loadAgentMetadata('http://127.0.0.1:1234', fetchResponse)).toEqual([agent]);
    expect(fetchResponse).toHaveBeenCalledOnce();
    expect(requestUrl(fetchResponse.mock.calls[0]?.[0])).toBe('http://127.0.0.1:1234/agents');
  });

  it('rejects malformed metadata', async () => {
    await expect(loadAgentMetadata('http://localhost', async () => Response.json([{...agent, instructions: 'private'}]))).rejects.toThrow('unrecognized_keys');
    await expect(loadAgentMetadata('http://localhost', async () => Response.json({agents: [agent]}))).rejects.toThrow('The agent list is invalid.');
  });
});
