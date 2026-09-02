import { readFile, stat, writeFile } from 'node:fs/promises';
import { popBackup, pushBackup } from './edit-backups';
import { MAX_EDIT_FILE_BYTES, resolveInProject } from './shared';

function lineEndingStyle(text: string): 'CRLF' | 'LF' | null {
    if (text.includes('\r\n')) return 'CRLF';
    if (text.includes('\n')) return 'LF';
    return null;
}

/** A multi-line oldText copied from a source with different line endings than the file
 * fails the exact-match check with no obvious reason - this turns that into a specific hint. */
function lineEndingHint(content: string, oldText: string): string | null {
    const contentStyle = lineEndingStyle(content);
    const oldTextStyle = lineEndingStyle(oldText);

    if (contentStyle === null || oldTextStyle === null || contentStyle === oldTextStyle) return null;
    return `the file uses ${contentStyle} line endings but oldText uses ${oldTextStyle} - check for stray/missing \\r characters`;
}

/** Non-overlapping match start indices, in the same order String.split(oldText) would consume them. */
function matchIndices(content: string, oldText: string): number[] {
    const indices: number[] = [];
    let from = 0;

    for (let idx = content.indexOf(oldText, from); idx !== -1; idx = content.indexOf(oldText, from)) {
        indices.push(idx);
        from = idx + oldText.length;
    }

    return indices;
}

/** Maps each (ascending) char index to its 1-based line number in a single pass over content. */
function lineNumbersForIndices(content: string, indices: number[]): number[] {
    const lines: number[] = [];
    let line = 1;
    let pos = 0;

    for (const idx of indices) {
        while (pos < idx) {
            if (content[pos] === '\n') line++;
            pos++;
        }
        lines.push(line);
    }

    return lines;
}

const MAX_MATCH_LOCATIONS_SHOWN = 5;

/** Describes why oldText fails the exact-match requirement against content, or null if it's fine. */
function editProblem(content: string, oldText: string, path: string, label: string): string | null {
    const indices = matchIndices(content, oldText);
    if (indices.length === 1) return null;

    if (indices.length === 0) {
        const hint = lineEndingHint(content, oldText);
        return `${label}: oldText not found in ${path}${hint ? ` - ${hint}` : ''}`;
    }

    const lines = lineNumbersForIndices(content, indices);
    const shown = lines.slice(0, MAX_MATCH_LOCATIONS_SHOWN).map(line => `${path}:${line}`).join(', ');
    const remaining = lines.length - MAX_MATCH_LOCATIONS_SHOWN;
    const more = remaining > 0 ? `, and ${remaining} more` : '';
    return `${label}: oldText matches ${indices.length} locations in ${path} (${shown}${more}) - include more context to make it unique`;
}

/** The full line(s) an [start, end) char span touches, expanded out to the nearest newlines on
 * either side - a diff hunk needs to show whole lines even when a match starts or ends mid-line. */
function lineBoundsForSpan(content: string, start: number, end: number): { lineStart: number; lineEnd: number } {
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const nextNewline = content.indexOf('\n', end);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    return { lineStart, lineEnd };
}

/** A single edit's effect rendered as a unified-diff-style hunk: the whole line(s) it touches,
 * before and after, so a reviewer can see the change without the file actually being written. */
function diffHunk(content: string, startIndex: number, oldText: string, newText: string, path: string, label: string): string {
    const endIndex = startIndex + oldText.length;
    const { lineStart, lineEnd } = lineBoundsForSpan(content, startIndex, endIndex);
    const [startLine] = lineNumbersForIndices(content, [lineStart]);

    const removed = content.slice(lineStart, lineEnd).split('\n').map(line => `-${line}`);
    const added = (content.slice(lineStart, startIndex) + newText + content.slice(endIndex, lineEnd)).split('\n').map(line => `+${line}`);

    return [`@@ ${path}:${startLine} (${label}) @@`, ...removed, ...added].join('\n');
}

type Edit = { oldText: string; newText: string };

/** Requires an exact, unique match per edit rather than a first-occurrence replace, so a vague
 * oldText can't silently edit the wrong spot. Multiple edits are applied atomically: every edit
 * must cleanly match the original content before any of them are written. Pass dryRun to preview
 * the resulting diff without writing anything. */
export async function execute(input: { path: string; edits: Edit[]; dryRun?: boolean }, cwd: string): Promise<string> {
    const target = resolveInProject(cwd, input.path);

    // Check the size before reading - loading a huge file into memory just to
    // find and replace one snippet is wasteful, and we'd write it all back out too.
    const { size } = await stat(target);
    if (size > MAX_EDIT_FILE_BYTES) {
        return `Error: ${input.path} is ${size} bytes, over the ${MAX_EDIT_FILE_BYTES}-byte limit for edit_file - use bash (e.g. sed) for large files`;
    }

    const originalContent = await readFile(target, 'utf-8');
    const label = (i: number) => (input.edits.length > 1 ? `edit ${i + 1}/${input.edits.length}` : 'edit');

    // Validate every edit against the original content up front, so a batch with several
    // problems reports all of them in one round-trip instead of one at a time.
    const problems = input.edits
        .map((edit, i) => editProblem(originalContent, edit.oldText, input.path, label(i)))
        .filter((problem): problem is string => problem !== null);

    if (problems.length > 0) return `Error: ${problems.join('; ')}`;

    let content = originalContent;
    const hunks: string[] = [];

    for (const [i, edit] of input.edits.entries()) {
        // Re-check against content as left by earlier edits in this batch - an earlier edit
        // can change how many times a later oldText appears, even though each was independently
        // unique against the original.
        const problem = editProblem(content, edit.oldText, input.path, label(i));
        if (problem !== null) return `Error: ${problem} (caused by an earlier edit in this batch - no changes were written)`;

        if (input.dryRun) {
            const [startIndex] = matchIndices(content, edit.oldText);
            hunks.push(diffHunk(content, startIndex!, edit.oldText, edit.newText, input.path, label(i)));
        }

        // split/join rather than String.replace: replace() treats $&, $1, etc. in the
        // replacement as special patterns even though newText is meant to be a literal string.
        content = content.split(edit.oldText).join(edit.newText);
    }

    if (input.dryRun) return `Dry run - no changes written to ${input.path}:\n\n${hunks.join('\n\n')}`;

    // Recorded after validation succeeds but before the write, so undo_edit can restore
    // exactly what was on disk immediately before this call - never a partially-applied state.
    pushBackup(target, originalContent);

    await writeFile(target, content, 'utf-8');
    return input.edits.length > 1 ? `Applied ${input.edits.length} edits to ${input.path}` : `Edited ${input.path}`;
}

/** Reverts the most recent edit_file write to `path`, going back one step per call. */
export async function undo(input: { path: string }, cwd: string): Promise<string> {
    const target = resolveInProject(cwd, input.path);
    const previous = popBackup(target);

    if (previous === undefined) return `Error: no edit_file backup available for ${input.path}`;

    await writeFile(target, previous, 'utf-8');
    return `Reverted ${input.path} to its state before the last edit_file change`;
}
