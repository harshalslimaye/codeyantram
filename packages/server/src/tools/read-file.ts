import { open, stat, type FileHandle } from 'node:fs/promises';
import { BINARY_SAMPLE_BYTES, MAX_OUTPUT_CHARS, MAX_READ_FILE_BYTES, isBinary, pickEncoding, resolveRealInProject, type TextEncodingLabel } from './shared';
import { formatNestedInstructions, loadNestedInstructions } from '../lib/project-instructions';

const CHUNK_BYTES = 64 * 1024;
const DEFAULT_LIMIT = 2000;
/** Per-line ceiling. Stops one pathological line - a minified bundle, a base64 blob, a
 * file with no newlines at all - from eating the whole output budget, and from being
 * accumulated in memory while we scan for a newline that never arrives. */
const MAX_LINE_CHARS = 2000;

type ReadFileInput = { path: string; offset?: number; limit?: number };

/** Yields the file in chunks, starting with the sample already read for the binary sniff
 * so the head isn't read from disk twice. The buffer is reused between yields, so each
 * chunk has to be consumed before the next one is pulled. */
async function* readChunks(handle: FileHandle, sample: Buffer): AsyncGenerator<Buffer> {
    yield sample;

    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let position = sample.length;

    while (true) {
        const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, position);
        if (bytesRead === 0) return;

        position += bytesRead;
        yield buffer.subarray(0, bytesRead);
    }
}

type StopReason = 'eof' | 'limit' | 'output' | 'scan-limit';

type Collected = {
    lines: string[];
    firstLine: number;
    lastLine: number;
    shortenedLines: number;
    stopReason: StopReason;
    /** Only exact when stopReason is 'eof' - nothing else has seen the whole file. */
    totalLines: number;
};

/** Walks the file line by line, keeping only the requested window. Nothing outside that
 * window is retained, so paging deep into a large file costs scan time but not memory -
 * which is the whole reason this streams rather than reading the file into a string. */
async function collectLines(handle: FileHandle, sample: Buffer, encoding: TextEncodingLabel, offset: number, limit: number, size: number): Promise<Collected> {
    const decoder = new TextDecoder(encoding);
    const lines: string[] = [];

    let lineNo = 1;
    let firstLine = 0;
    let lastLine = 0;
    let usedChars = 0;
    let shortenedLines = 0;
    let bytesScanned = 0;
    let stopReason: StopReason = 'eof';

    let pending = '';
    let shortened = false;

    /** Appends to the line being assembled, dropping whatever runs past MAX_LINE_CHARS. */
    const append = (text: string): void => {
        if (shortened) return;

        pending += text;
        if (pending.length > MAX_LINE_CHARS) {
            pending = pending.slice(0, MAX_LINE_CHARS);
            shortened = true;
        }
    };

    /** Takes the finished line, returning false once the caller should stop reading. */
    const take = (): boolean => {
        const content = pending;
        const wasShortened = shortened;
        pending = '';
        shortened = false;

        if (lineNo >= offset) {
            // Reaching the limit means there was another line to show, not that the
            // file ended here - that difference is what the "pass offset=N" note needs.
            if (lines.length >= limit) {
                stopReason = 'limit';
                return false;
            }

            const rendered = `${lineNo}\t${content}${wasShortened ? ' …' : ''}`;
            if (usedChars + rendered.length + 1 > MAX_OUTPUT_CHARS) {
                stopReason = 'output';
                return false;
            }

            lines.push(rendered);
            usedChars += rendered.length + 1;
            if (wasShortened) shortenedLines++;
            if (firstLine === 0) firstLine = lineNo;
            lastLine = lineNo;
        }

        lineNo++;
        return true;
    };

    outer: for await (const chunk of readChunks(handle, sample)) {
        bytesScanned += chunk.length;
        const text = decoder.decode(chunk, { stream: true });
        let start = 0;

        for (let i = 0; i < text.length; i++) {
            if (text[i] !== '\n') continue;

            append(text.slice(start, i));
            start = i + 1;
            if (!take()) break outer;
        }

        append(text.slice(start));

        // Only a stop when there is actually more file left - a file that ends exactly
        // on the budget has been read in full, and should report 'eof' like any other.
        if (bytesScanned >= MAX_READ_FILE_BYTES && bytesScanned < size) {
            stopReason = 'scan-limit';
            break outer;
        }
    }

    if (stopReason === 'eof') {
        append(decoder.decode()); // flush a partial sequence left dangling at EOF
        // A file ending in a newline has nothing pending - only a final unterminated
        // line is still sitting here waiting to be taken.
        if (pending.length > 0) take();
    }

    return { lines, firstLine, lastLine, shortenedLines, stopReason, totalLines: lineNo - 1 };
}

/** Node's raw ENOENT/EACCES/EISDIR messages are cryptic (path repeated twice, errno
 * noise) - surface a plain sentence instead, same as list_dir's assertListable. */
async function statForRead(target: string, displayPath: string): Promise<number> {
    let stats;
    try {
        stats = await stat(target);
    } catch (error) {
        const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
        if (code === 'ENOENT') throw new Error(`"${displayPath}" does not exist`);
        if (code === 'EACCES') throw new Error(`Permission denied reading "${displayPath}"`);
        throw error;
    }

    if (stats.isDirectory()) throw new Error(`"${displayPath}" is a directory - use list_dir`);
    return stats.size;
}

/** Reads a window of lines, numbered like `grep -n` so the model can hand a line straight
 * back to edit_file. Every read is bounded three ways - lines returned, characters
 * returned, and bytes scanned - and each of those says in the output how to fetch the
 * rest, rather than cutting off silently.
 *
 * `seen` opts into nested-instructions discovery (see project-instructions.ts): when
 * provided, any AGENTS.md/CLAUDE.md between this file and the project root that hasn't
 * already surfaced this turn is appended to the output. Passing nothing (the toggle is
 * off, or a caller that doesn't care about this) skips the walk entirely - it's not just
 * an empty dedup set, since even an empty Set would still search on every call. */
export async function execute(input: ReadFileInput, cwd: string, seen?: Set<string>): Promise<string> {
    const target = await resolveRealInProject(cwd, input.path);
    const offset = input.offset ?? 1;
    const limit = input.limit ?? DEFAULT_LIMIT;

    // Checked before the file is opened: the size decides how much of a sample there is
    // to sniff, and a directory or missing path should fail with its own message rather
    // than an EISDIR from the first read.
    const size = await statForRead(target, input.path);
    if (size === 0) return `${input.path} is empty (0 bytes)`;

    const handle = await open(target, 'r');

    try {
        // Only the sniff sample is read up front - a binary file is rejected after 8 KB,
        // never after being loaded whole and then thrown away.
        const buffer = Buffer.allocUnsafe(Math.min(BINARY_SAMPLE_BYTES, size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const sample = buffer.subarray(0, bytesRead);

        if (isBinary(sample)) throw new Error(`Cannot read binary file: ${input.path}`);

        const encoding = pickEncoding(sample, size > sample.length);
        const collected = await collectLines(handle, sample, encoding, offset, limit, size);

        if (collected.lines.length === 0) {
            if (collected.stopReason === 'scan-limit') {
                return `Error: reached the ${MAX_READ_FILE_BYTES}-byte scan limit for read_file before line ${offset} of ${input.path} (${size} bytes) - use bash (e.g. sed -n) to read this deep into a file this large`;
            }
            return `Error: offset ${offset} is past the end of ${input.path}, which has ${collected.totalLines} lines`;
        }

        const notes: string[] = [];
        const next = collected.lastLine + 1;
        const shown = `lines ${collected.firstLine}-${collected.lastLine}`;

        if (encoding !== 'utf-8') notes.push(`… decoded as ${encoding} (Latin-1): ${input.path} is not valid UTF-8`);
        if (collected.shortenedLines > 0) {
            notes.push(`… ${collected.shortenedLines} line(s) longer than ${MAX_LINE_CHARS} chars truncated to their first ${MAX_LINE_CHARS} chars (marked with a trailing …)`);
        }

        if (collected.stopReason === 'limit') {
            notes.push(`… showed ${shown}, truncated at limit=${limit} - more lines follow, pass offset=${next} to continue reading ${input.path}`);
        } else if (collected.stopReason === 'output') {
            notes.push(`… showed ${shown}, truncated at the ${MAX_OUTPUT_CHARS}-char output limit - pass offset=${next} to continue reading ${input.path}`);
        } else if (collected.stopReason === 'scan-limit') {
            notes.push(
                `… showed ${shown}, truncated at the ${MAX_READ_FILE_BYTES}-byte scan limit for read_file (${input.path} is ${size} bytes) - use bash (e.g. sed -n) to read further`,
            );
        }

        const content = [...collected.lines, ...notes].join('\n');
        if (seen === undefined) return content;

        const nested = await loadNestedInstructions(cwd, input.path, seen);
        const block = formatNestedInstructions(nested);
        return block === '' ? content : `${content}\n\n${block}`;
    } finally {
        await handle.close();
    }
}
