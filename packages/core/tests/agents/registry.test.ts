import {describe, expect, it} from 'vitest';
import {createAgentRegistry} from '../../src/agents/index.js';

const reviewer = {id: 'user:reviewer', instructions: 'Check the implementation against its callers.'};

describe('agent registry', () => {
  it('resolves a custom Ask agent with shared instructions and a frozen tool policy', () => {
    const registry = createAgentRegistry([{source: 'user', definition: reviewer, filePath: '/agents/reviewer.md'}]);
    const agent = registry.get('user:reviewer');
    expect(registry.diagnostics()).toEqual([]);
    expect(agent).toMatchObject({id: 'user:reviewer', source: 'user', name: 'Reviewer', approval: 'none'});
    expect(agent?.instructions).toContain('MODE: ASK');
    expect(agent?.instructions).toContain(reviewer.instructions);
    expect(agent?.tools).not.toContain('bash');
    expect(Object.isFrozen(agent)).toBe(true);
    expect(Object.isFrozen(agent?.tools)).toBe(true);
  });

  it('allows a custom Build agent to narrow tools without changing its approval policy', () => {
    const registry = createAgentRegistry([{source: 'project', definition: {
      id: 'project:fixer', extends: 'build', instructions: 'Fix the failing case.', tools: ['read', 'apply_patch'],
    }}]);
    expect(registry.get('project:fixer')).toMatchObject({approval: 'prompt', tools: ['read', 'apply_patch']});
    expect(registry.get('project:fixer')?.instructions).toContain('MODE: BUILD');
  });

  it('rejects unknown, broadened, duplicate, and source-mismatched definitions without losing built-ins', () => {
    const registry = createAgentRegistry([
      {source: 'user', definition: {...reviewer, tools: ['read', 'bash']}},
      {source: 'user', definition: {...reviewer, tools: ['unknown_tool']}},
      {source: 'project', definition: reviewer},
      {source: 'user', definition: {...reviewer, id: 'ask'}},
      {source: 'user', definition: reviewer},
      {source: 'user', definition: reviewer},
    ]);
    expect(registry.diagnostics()).toHaveLength(5);
    expect(registry.get('user:reviewer')?.approval).toBe('none');
    expect(registry.get('ask')?.source).toBe('builtin');
    expect(registry.list().map(agent => agent.id)).toEqual(['ask', 'build', 'yolo', 'user:reviewer']);
  });
});
