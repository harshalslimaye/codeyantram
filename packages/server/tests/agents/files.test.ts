import {mkdtemp, mkdir, writeFile, symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {loadAgentFiles, parseAgentFile} from '../../src/agents/files.js';

describe('custom agent files', () => {
  it('loads both sources with separate IDs and bounded tools', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codeyantram-agents-'));
    const user = path.join(root, 'config');
    const project = path.join(root, 'project');
    await mkdir(path.join(user, 'agents'), {recursive: true});
    await mkdir(path.join(project, '.codeyantram', 'agents'), {recursive: true});
    await writeFile(path.join(user, 'agents', 'reviewer.md'), 'Review code.');
    await writeFile(path.join(project, '.codeyantram', 'agents', 'reviewer.md'), '---\nextends: build\ntools: [read, apply_patch]\n---\nFix code.');
    const {registry, diagnostics} = await loadAgentFiles(project, user);
    expect(diagnostics).toEqual([]);
    expect(registry.get('user:reviewer')?.approval).toBe('none');
    expect(registry.get('project:reviewer')?.tools).toEqual(['read', 'apply_patch']);
  });

  it('reports malformed files and symlinks while keeping built-ins', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codeyantram-agents-'));
    const directory = path.join(root, 'agents');
    await mkdir(directory);
    await writeFile(path.join(directory, 'bad.md'), '---\nname: One\nname: Two\n---\nBody');
    await symlink(path.join(directory, 'bad.md'), path.join(directory, 'linked.md'));
    const {registry, diagnostics} = await loadAgentFiles(undefined, root);
    expect(registry.get('ask')).toBeDefined();
    expect(diagnostics).toHaveLength(2);
  });

  it('rejects tags and tools beyond the inherited agent', async () => {
    expect(() => parseAgentFile('---\nname: !unsafe foo\n---\nBody', 'user:test')).toThrow('Unsupported frontmatter value.');
    const root = await mkdtemp(path.join(tmpdir(), 'codeyantram-agents-'));
    await mkdir(path.join(root, 'agents'));
    await writeFile(path.join(root, 'agents', 'bad.md'), '---\ntools: [bash]\n---\nBody');
    const {registry, diagnostics} = await loadAgentFiles(undefined, root);
    expect(registry.get('user:bad')).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });
});
