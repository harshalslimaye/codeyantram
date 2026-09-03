// Line-level diffing for write_file. edit_file renders its own hunks around a matched span,
// which can't describe a whole-file replacement - this compares two whole versions instead.
//
// The common head and tail are trimmed first, and only what's left is run through an LCS
// pass. That keeps the quadratic step off the parts of the file that didn't change, and a
// region too large for it (a wholesale rewrite of a big file) degrades to "everything here
// was replaced" rather than allocating a table proportional to the file size.

const CONTEXT_LINES = 3;
/** Ceiling on the LCS table, in cells - roughly 1 MB as Int32, hit at about 500x500 lines. */
const MAX_DIFF_CELLS = 250_000;
const MAX_PREVIEW_LINES = 80;

/** Splits into lines without the trailing newline producing a phantom empty last line. */
function splitLines(text: string): string[] {
    if (text === '') return [];

    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();

    return lines;
}

type Op = {
    kind: ' ' | '-' | '+';
    text: string;
    /** 1-based line number in the file as it is now - what a reviewer would look up. */
    line: number;
};

/** Longest-common-subsequence diff of two line arrays, as an ordered op list. `offset` is how
 * many identical lines were trimmed off the front, so reported line numbers stay absolute. */
function lcsOps(before: string[], after: string[], offset: number): Op[] {
    const rows = before.length;
    const cols = after.length;
    const width = cols + 1;
    const table = new Int32Array((rows + 1) * width);

    for (let i = rows - 1; i >= 0; i--) {
        for (let j = cols - 1; j >= 0; j--) {
            table[i * width + j] =
                before[i] === after[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
        }
    }

    const ops: Op[] = [];
    let i = 0;
    let j = 0;

    while (i < rows && j < cols) {
        if (before[i] === after[j]) {
            ops.push({ kind: ' ', text: before[i]!, line: offset + i + 1 });
            i++;
            j++;
        } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
            ops.push({ kind: '-', text: before[i]!, line: offset + i + 1 });
            i++;
        } else {
            // An addition sits between the surrounding before-lines, so it reports the line
            // it's being inserted ahead of.
            ops.push({ kind: '+', text: after[j]!, line: offset + i + 1 });
            j++;
        }
    }

    while (i < rows) ops.push({ kind: '-', text: before[i]!, line: offset + i++ + 1 });
    while (j < cols) ops.push({ kind: '+', text: after[j++]!, line: offset + i + 1 });

    return ops;
}

/** The full op list for two versions: trimmed common head/tail as context, changes in between. */
function diffOps(before: string[], after: string[]): Op[] {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;

    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--;
        endAfter--;
    }

    const regionBefore = before.slice(start, endBefore);
    const regionAfter = after.slice(start, endAfter);

    const region =
        regionBefore.length * regionAfter.length <= MAX_DIFF_CELLS
            ? lcsOps(regionBefore, regionAfter, start)
            : [
                  ...regionBefore.map((text, i): Op => ({ kind: '-', text, line: start + i + 1 })),
                  ...regionAfter.map((text): Op => ({ kind: '+', text, line: start + 1 })),
              ];

    // A few unchanged lines on either side of the region, so a hunk reads in context.
    const headStart = Math.max(0, start - CONTEXT_LINES);
    const head = before.slice(headStart, start).map((text, i): Op => ({ kind: ' ', text, line: headStart + i + 1 }));
    const tail = before.slice(endBefore, endBefore + CONTEXT_LINES).map((text, i): Op => ({ kind: ' ', text, line: endBefore + i + 1 }));

    return [...head, ...region, ...tail];
}

/** How many lines an overwrite adds and removes - the one-line "is this destructive?" answer
 * that belongs in the result of every overwrite, dry run or not. */
export function lineDiffSummary(before: string, after: string): { added: number; removed: number } {
    const ops = diffOps(splitLines(before), splitLines(after));

    return {
        added: ops.filter(op => op.kind === '+').length,
        removed: ops.filter(op => op.kind === '-').length,
    };
}

/** Index ranges to render: every change plus CONTEXT_LINES either side, with overlapping
 * windows merged so neighbouring changes share one hunk instead of repeating context. */
function hunkRanges(ops: Op[]): [number, number][] {
    const ranges: [number, number][] = [];

    ops.forEach((op, i) => {
        if (op.kind === ' ') return;

        const start = Math.max(0, i - CONTEXT_LINES);
        const end = Math.min(ops.length - 1, i + CONTEXT_LINES);
        const last = ranges[ranges.length - 1];

        if (last !== undefined && start <= last[1] + 1) last[1] = Math.max(last[1], end);
        else ranges.push([start, end]);
    });

    return ranges;
}

/** The change as unified-diff-style hunks, in the same shape edit_file's dryRun output takes
 * so both tools preview a change the same way. */
export function lineDiffPreview(before: string, after: string, path: string): string {
    const ops = diffOps(splitLines(before), splitLines(after));
    const ranges = hunkRanges(ops);

    if (ranges.length === 0) return `(identical - writing this would not change ${path})`;

    const rendered: string[] = [];
    let shown = 0;
    let omitted = 0;

    for (const [start, end] of ranges) {
        if (shown >= MAX_PREVIEW_LINES) {
            omitted += end - start + 1;
            continue;
        }

        rendered.push(`@@ ${path}:${ops[start]!.line} @@`);
        for (let i = start; i <= end; i++) {
            if (shown >= MAX_PREVIEW_LINES) {
                omitted += end - i + 1;
                break;
            }

            rendered.push(`${ops[i]!.kind}${ops[i]!.text}`);
            shown++;
        }
    }

    if (omitted > 0) rendered.push(`… ${omitted} more diff line(s)`);

    return rendered.join('\n');
}

/** Lines in a piece of text, counted the way an editor's status bar counts them. */
export function countLines(text: string): number {
    return splitLines(text).length;
}
