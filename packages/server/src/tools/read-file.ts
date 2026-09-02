import { open, stat, type FileHandle } from 'node:fs/promises';
import { MAX_OUTPUT_CHARS, MAX_READ_FILE_BYTES, resolveRealInProject } from './shared';

const BINARY_SAMPLE_BYTES = 8192;
const CHUNK_BYTES = 64 * 1024;
const DEFAULT_LIMIT = 2000;
/** Per-line ceiling. Stops one pathological line - a minified bundle, a base64 blob, a
 * file with no newlines at all - from eating the whole output budget, and from being
 * accumulated in memory while we scan for a newline that never arrives. */
const MAX_LINE_CHARS = 2000;

type ReadFileInput = { path: string; offset?: number; limit?: number };

// WHATWG label for Latin-1: the standard folds latin1/iso-8859-1 onto the windows-1252
// decoder, which is the one that actually maps 0x80-0x9F to printable characters.
type TextEncodingLabel = 'utf-8' | 'windows-1252';

/** Sniffs the first few KB for null bytes or a high ratio of non-printable bytes, the same heuristic `file(1)` and most editors use. */
function isBinary(sample: Buffer): boolean {
    if (sample.length === 0) return false;

    let nonPrintable = 0;
    for (const byte of sample) {
        if (byte === 0) return true;
        if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++;
    }

    return nonPrintable / sample.length > 0.3;
}

/** Drops a multi-byte UTF-8 sequence left incomplete by the sample's cut-off point -
 * those trailing bytes are only half a character, and validating them would report a
 * perfectly good UTF-8 file as some other encoding. */
function trimIncompleteUtf8Tail(sample: Buffer): Buffer {
    for (let i = sample.length - 1, available = 1; i >= 0 && available <= 4; i--, available++) {
        const byte = sample[i]!;
        if ((byte & 0b1100_0000) === 0b1000_0000) continue; // continuation byte - keep walking back to the lead byte

        const expected =
            byte < 0x80 ? 1 : (byte & 0b1110_0000) === 0b1100_0000 ? 2 : (byte & 0b1111_0000) === 0b1110_0000 ? 3 : (byte & 0b1111_1000) === 0b1111_0000 ? 4 : 1;

        return expected > available ? sample.subarray(0, i) : sample;
    }

    return sample;
}

/** Decoding a Latin-1 file as UTF-8 silently fills it with replacement characters, so the
 * encoding is decided up front from the same sample the binary sniff used: valid UTF-8
 * wins, anything else falls back to latin1. Only the sample is checked - a file whose
 * first 8 KB is clean UTF-8 but turns invalid later is rare enough to not be worth
 * scanning the whole file for. */
function pickEncoding(sample: Buffer, sampleIsPartial: boolean): TextEncodingLabel {
    const candidate = sampleIsPartial ? trimIncompleteUtf8Tail(sample) : sample;

    try {
        new TextDecoder('utf-8', { fatal: true }).decode(candidate);
        return 'utf-8';
    } catch {
        return 'windows-1252';
    }
}

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
 * rest, rather than cutting off silently. */
export async function execute(input: ReadFileInput, cwd: string): Promise<string> {
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

        return [...collected.lines, ...notes].join('\n');
    } finally {
        await handle.close();
    }
}
