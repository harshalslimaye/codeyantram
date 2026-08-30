import fg from 'fast-glob';

// fast-glob rather than Bun.Glob so the built server can run under plain Node.js.
export async function execute(input: { pattern: string }, cwd: string): Promise<string> {
    const matches = await fg(input.pattern, { cwd, dot: false });
    return matches.sort().join('\n') || 'No matches.';
}
