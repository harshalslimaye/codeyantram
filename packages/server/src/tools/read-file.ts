import { readFile } from 'node:fs/promises';
import { resolveInProject, truncate } from './shared';

const BINARY_SAMPLE_BYTES = 8192;

/** Sniffs the first few KB for null bytes or a high ratio of non-printable bytes, the same heuristic `file(1)` and most editors use. */
function isBinary(buffer: Buffer): boolean {
    if (buffer.length === 0) return false;

    const sample = buffer.subarray(0, BINARY_SAMPLE_BYTES);
    let nonPrintable = 0;
    for (const byte of sample) {
        if (byte === 0) return true;
        if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++;
    }

    return nonPrintable / sample.length > 0.3;
}

export async function execute(input: { path: string }, cwd: string): Promise<string> {
    const target = resolveInProject(cwd, input.path);
    const buffer = await readFile(target);

    if (isBinary(buffer)) {
        throw new Error(`Cannot read binary file: ${input.path}`);
    }

    return truncate(buffer.toString('utf-8'));
}
