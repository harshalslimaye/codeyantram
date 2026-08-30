import { readFile } from 'node:fs/promises';
import { resolveInProject } from './shared';

export async function execute(input: { path: string }, cwd: string): Promise<string> {
    return readFile(resolveInProject(cwd, input.path), 'utf-8');
}
