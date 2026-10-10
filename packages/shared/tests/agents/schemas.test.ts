import {describe, expect, it} from 'vitest';
import {agentDefinitionSchema, agentIdSchema, resolvedAgentSchema} from '../../src/index.js';

const definition = {id: 'user:reviewer', instructions: 'Review the code and explain findings.'};

describe('agent definition contract', () => {
  it('accepts a small custom definition and defaults its base to Ask', () => {
    expect(agentDefinitionSchema.parse(definition)).toEqual({...definition, extends: 'ask'});
  });

  it.each(['', 'Ask', 'user:', 'user:../reviewer', 'project:Reviewer', 'other:reviewer', 'user:ask!'])(
    'rejects an invalid or ambiguous ID: %s', id => {
      expect(agentIdSchema.safeParse(id).success).toBe(false);
    },
  );

  it('rejects duplicate tools, unknown fields, and blank instructions', () => {
    expect(agentDefinitionSchema.safeParse({...definition, tools: ['read', 'read']}).success).toBe(false);
    expect(agentDefinitionSchema.safeParse({...definition, approval: 'automatic'}).success).toBe(false);
    expect(agentDefinitionSchema.safeParse({...definition, instructions: '  '}).success).toBe(false);
  });

  it('requires a resolved agent ID to match its source', () => {
    const resolved = {id: 'project:reviewer', name: 'Reviewer', description: 'Read code.',
      instructions: 'Review code.', source: 'project', tools: ['read'], approval: 'none'};
    expect(resolvedAgentSchema.safeParse(resolved).success).toBe(true);
    expect(resolvedAgentSchema.safeParse({...resolved, source: 'user'}).success).toBe(false);
    expect(resolvedAgentSchema.safeParse({...resolved, id: 'ask'}).success).toBe(false);
  });
});
