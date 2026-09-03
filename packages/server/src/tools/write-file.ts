import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { countLines, lineDiffPreview, lineDiffSummary } from './diff';
import { pushBackup } from './file-backups';
import { BINARY_SAMPLE_BYTES, MAX_WRITE_FILE_BYTES, isBinary, resolveRealForWrite, type WriteTarget } from './shared';

type WriteFileInput = { path: string; content: string; encoding?: 'utf-8' | 'base64'; dryRun?: boolean };

/** Buffer.from(content, 'base64') is lenient - it skips anything outside the alphabet and
 * accepts a truncated final group, so a corrupted or accidentally-not-base64 string decodes
 * to plausible-looking garbage and gets written to disk. Re-encoding and comparing is the
 * cheapest way to insist the input was actually canonical base64. */
function decodeBase64(content: string): Buffer | null {
    const compact = content.replace(/\s+/g, '');
    if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;

    const bytes = Buffer.from(compact, 'base64');
    return bytes.toString('base64') === compact ? bytes : null;
}

type Existing = {
    size: number;
    /** The file's current contents, or null when it's too big to hold for a backup/diff. */
    bytes: Buffer | null;
    binary: boolean;
};

/** Stats the path the write is aimed at, reporting a missing file as null rather than an error -
 * that's the create case, not a failure. Node's raw EACCES/EISDIR messages are cryptic, so those
 * become plain sentences, same as read_file's statForRead. */
async function inspectTarget(target: string, displayPath: string): Promise<Existing | null> {
    let stats;
    try {
        stats = await stat(target);
    } catch (error) {
        const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
        if (code === 'ENOENT') return null;
        if (code === 'EACCES') throw new Error(`Permission denied writing "${displayPath}"`);
        throw error;
    }

    if (stats.isDirectory()) throw new Error(`"${displayPath}" is a directory - write to a path inside it, not to the directory itself`);

    // Over the limit there's nothing useful to do with the old contents: they're too big to
    // keep as an undo backup and too big to diff, so they're not read at all.
    if (stats.size > MAX_WRITE_FILE_BYTES) return { size: stats.size, bytes: null, binary: false };

    const bytes = await readFile(target);
    return { size: stats.size, bytes, binary: isBinary(bytes.subarray(0, BINARY_SAMPLE_BYTES)) };
}

/** "12 lines / 300 bytes" for text, bytes alone for content with no meaningful line structure. */
function describe(size: number, text: string | null): string {
    if (text === null) return `${size} bytes`;

    const lines = countLines(text);
    return `${lines} line${lines === 1 ? '' : 's'} / ${size} bytes`;
}

/** Trailing qualifiers about the path itself - both are things the caller didn't ask for
 * explicitly and would otherwise never learn about. */
function pathNotes({ viaSymlink, missingDirs }: WriteTarget, dryRun: boolean): string[] {
    const notes: string[] = [];

    if (viaSymlink) notes.push(dryRun ? 'would write through a symlink' : 'through a symlink');
    if (missingDirs > 0) {
        const dirs = `${missingDirs} parent director${missingDirs === 1 ? 'y' : 'ies'}`;
        notes.push(dryRun ? `would create ${dirs}` : `created ${dirs}`);
    }

    return notes;
}

function withNotes(line: string, notes: (string | null)[]): string {
    const shown = notes.filter((note): note is string => note !== null);
    return shown.length > 0 ? `${line} (${shown.join('; ')})` : line;
}

/** Creates or completely replaces a file. Overwriting is destructive in a way edit_file's
 * unique-match requirement isn't, so every overwrite says what it cost (lines added/removed,
 * size before and after), records the previous contents for undo_edit, and can be previewed
 * with dryRun first. Content is capped, decoded strictly, and the path is checked for symlink
 * escapes and for asking mkdir -p to invent an implausible directory chain. */
export async function execute(input: WriteFileInput, cwd: string): Promise<string> {
    const encoding = input.encoding ?? 'utf-8';
    const bytes = encoding === 'base64' ? decodeBase64(input.content) : Buffer.from(input.content, 'utf-8');

    if (bytes === null) return `Error: content is not valid base64 - drop the encoding option to write it as UTF-8 text`;

    // Checked before touching the filesystem: an oversized write should cost nothing and
    // leave nothing behind, not fail partway through a create.
    if (bytes.length > MAX_WRITE_FILE_BYTES) {
        return `Error: content is ${bytes.length} bytes, over the ${MAX_WRITE_FILE_BYTES}-byte limit for write_file - write it in pieces or use bash for large files`;
    }

    const location = await resolveRealForWrite(cwd, input.path);
    const { target } = location;
    const existing = await inspectTarget(target, input.path);

    // Line counts and diffs only mean something for text on both sides.
    const newText = encoding === 'base64' ? null : input.content;
    const oldText = existing !== null && existing.bytes !== null && !existing.binary ? existing.bytes.toString('utf-8') : null;
    const diff = oldText !== null && newText !== null ? lineDiffSummary(oldText, newText) : null;

    const noDiffReason =
        existing === null || diff !== null
            ? null
            : newText === null
              ? 'writing base64 content - diff not shown'
              : existing.bytes === null
                ? `${input.path} is ${existing.size} bytes - diff not shown`
                : 'previous content is binary - diff not shown';

    if (input.dryRun) {
        const notes = pathNotes(location, true);

        if (existing === null) return withNotes(`Dry run - would create ${input.path} (${describe(bytes.length, newText)})`, notes);
        if (oldText !== null && newText !== null) {
            return `${withNotes(`Dry run - no changes written to ${input.path}`, notes)}:\n\n${lineDiffPreview(oldText, newText, input.path)}`;
        }

        return withNotes(`Dry run - would overwrite ${input.path}: ${existing.size} bytes → ${bytes.length} bytes`, [noDiffReason, ...notes]);
    }

    // Recorded before the write, so undo_edit restores exactly what was on disk immediately
    // before this call. A file being created has no previous state - nothing to record.
    let backupNote: string | null = null;
    if (existing !== null) {
        if (existing.bytes !== null) pushBackup(target, existing.bytes);
        else backupNote = `no undo backup: ${input.path} was ${existing.size} bytes, over the ${MAX_WRITE_FILE_BYTES}-byte backup limit`;
    }

    if (location.missingDirs > 0) await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);

    const notes = pathNotes(location, false);
    if (existing === null) return withNotes(`Created ${input.path} (${describe(bytes.length, newText)})`, notes);

    const change = diff === null ? '' : diff.added === 0 && diff.removed === 0 ? ' (content unchanged)' : ` (+${diff.added}/-${diff.removed} lines)`;

    return withNotes(`Overwrote ${input.path}${change}: ${describe(existing.size, oldText)} → ${describe(bytes.length, newText)}`, [
        noDiffReason,
        ...notes,
        backupNote,
    ]);
}
