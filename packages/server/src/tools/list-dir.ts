import { readdir } from 'node:fs/promises';
import { resolveInProject } from './shared';

export async function execute(input: { path: string }, cwd: string): Promise<string> {
    const entries = await readdir(resolveInProject(cwd, input.path), { withFileTypes: true });
    return entries
        .map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort()
        .join('\n');
}
