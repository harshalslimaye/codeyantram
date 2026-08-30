import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveInProject } from './shared';

export async function execute(input: { path: string; content: string }, cwd: string): Promise<string> {
    const target = resolveInProject(cwd, input.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.content, 'utf-8');
    return `Wrote ${input.path}`;
}
