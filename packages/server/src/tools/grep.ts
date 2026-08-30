import { resolveInProject, runCommand } from './shared';

export async function execute(input: { pattern: string; path: string }, cwd: string): Promise<string> {
    const output = await runCommand(['grep', '-rn', '-E', input.pattern, resolveInProject(cwd, input.path)], cwd);
    return output || 'No matches.';
}
