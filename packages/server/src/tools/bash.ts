import { runCommand } from './shared';

export async function execute(input: { command: string }, cwd: string): Promise<string> {
    const output = await runCommand(['bash', '-c', input.command], cwd);
    return output || '(no output)';
}
