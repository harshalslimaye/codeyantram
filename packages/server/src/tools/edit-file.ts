import { readFile, writeFile } from 'node:fs/promises';
import { resolveInProject } from './shared';

/** Requires an exact, unique match rather than a first-occurrence replace, so a vague oldText can't silently edit the wrong spot. */
export async function execute(
    input: { path: string; oldText: string; newText: string },
    cwd: string,
): Promise<string> {
    const target = resolveInProject(cwd, input.path);
    const content = await readFile(target, 'utf-8');
    const occurrences = content.split(input.oldText).length - 1;

    if (occurrences === 0) return `Error: oldText not found in ${input.path}`;
    if (occurrences > 1) {
        return `Error: oldText matches ${occurrences} locations in ${input.path} - include more context to make it unique`;
    }

    await writeFile(target, content.replace(input.oldText, input.newText), 'utf-8');
    return `Edited ${input.path}`;
}
