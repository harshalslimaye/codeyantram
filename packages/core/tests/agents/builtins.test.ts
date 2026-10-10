import {describe, expect, it} from 'vitest';
import {toolNameSchema} from '@codeyantram/shared';
import {BUILTIN_AGENTS} from '../../src/agents/index.js';
import {TOOL_CATALOG} from '../../src/tools/catalog.js';

describe('Phase 1 agent inventory', () => {
  it('catalogs each existing tool once with a host service and instruction', () => {
    const names = TOOL_CATALOG.map(entry => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(['explore', 'find', 'inspect', 'trace', 'graph', 'web_fetch', 'read', 'grep', 'glob',
      'git_status', 'git_diff', 'git_log', 'git_show', 'apply_patch', 'bash']);
    for (const entry of TOOL_CATALOG) {
      expect(toolNameSchema.safeParse(entry.name).success).toBe(true);
      expect(entry.usageInstruction.trim()).not.toBe('');
      expect(typeof entry.factory).toBe('function');
    }
  });

  it('gives Ask only read capabilities and records distinct Build/Yolo approval policies', () => {
    const agents = new Map(BUILTIN_AGENTS.map(agent => [agent.id, agent]));
    expect([...agents.keys()]).toEqual(['ask', 'build', 'yolo']);
    expect(agents.get('ask')?.approval).toBe('none');
    expect(agents.get('build')?.approval).toBe('prompt');
    expect(agents.get('yolo')?.approval).toBe('automatic');
    expect(agents.get('ask')?.tools).not.toContain('apply_patch');
    expect(agents.get('ask')?.tools).not.toContain('bash');
    expect(agents.get('build')?.tools).toEqual(agents.get('yolo')?.tools);
    expect(agents.get('build')?.tools).toEqual(TOOL_CATALOG.map(entry => entry.name));
  });
});
