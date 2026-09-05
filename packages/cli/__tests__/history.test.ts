import { describe, test, expect } from 'bun:test';
import {
    MAX_HISTORY_ENTRIES,
    beginDraft,
    createHistory,
    isBrowsing,
    recallNext,
    recallPrevious,
    record,
    type HistoryState,
} from '../src/history';

/** A history holding `texts` in submission order, with nothing being browsed. */
function historyOf(...texts: string[]): HistoryState {
    return texts.reduce(record, createHistory());
}

describe('record', () => {
    test('appends submitted prompts oldest first', () => {
        expect(historyOf('first', 'second').entries).toEqual(['first', 'second']);
    });

    test('stores the trimmed prompt', () => {
        expect(historyOf('  padded  ').entries).toEqual(['padded']);
    });

    test('ignores an empty or whitespace-only prompt', () => {
        const state = historyOf('first');

        expect(record(state, '').entries).toEqual(['first']);
        expect(record(state, '   ').entries).toEqual(['first']);
    });

    test('does not store a prompt identical to the one before it', () => {
        expect(historyOf('same', 'same').entries).toEqual(['same']);
    });

    test('stores a repeat that is not consecutive', () => {
        expect(historyOf('a', 'b', 'a').entries).toEqual(['a', 'b', 'a']);
    });

    test('drops the oldest entries past the cap', () => {
        const overflowing = Array.from({ length: MAX_HISTORY_ENTRIES + 2 }, (_, i) => `prompt ${i}`);
        const state = historyOf(...overflowing);

        expect(state.entries.length).toBe(MAX_HISTORY_ENTRIES);
        expect(state.entries[0]).toBe('prompt 2');
        expect(state.entries[state.entries.length - 1]).toBe(`prompt ${MAX_HISTORY_ENTRIES + 1}`);
        // The cursor still means "composing", not an index past the end.
        expect(isBrowsing(state)).toBe(false);
    });

    test('ends browsing, so the next step back starts from the newest entry', () => {
        const browsing = recallPrevious(historyOf('first', 'second'), 'draft')!;
        expect(isBrowsing(browsing.state)).toBe(true);

        const submitted = record(browsing.state, 'third');

        expect(isBrowsing(submitted)).toBe(false);
        expect(submitted.draft).toBe('');
        expect(recallPrevious(submitted, '')!.text).toBe('third');
    });

    test('ends browsing even when the submitted prompt was a duplicate', () => {
        const browsing = recallPrevious(historyOf('first', 'second'), 'draft')!;
        const submitted = record(browsing.state, 'second');

        expect(submitted.entries).toEqual(['first', 'second']);
        expect(isBrowsing(submitted)).toBe(false);
        expect(submitted.draft).toBe('');
    });
});

describe('recallPrevious', () => {
    test('returns null when nothing has been submitted yet', () => {
        expect(recallPrevious(createHistory(), 'draft')).toBeNull();
    });

    test('recalls the newest entry first', () => {
        expect(recallPrevious(historyOf('first', 'second'), '')!.text).toBe('second');
    });

    test('walks further back on each step', () => {
        const newest = recallPrevious(historyOf('first', 'second', 'third'), '')!;
        const older = recallPrevious(newest.state, newest.text)!;
        const oldest = recallPrevious(older.state, older.text)!;

        expect([newest.text, older.text, oldest.text]).toEqual(['third', 'second', 'first']);
    });

    test('returns null at the oldest entry instead of wrapping', () => {
        const oldest = recallPrevious(historyOf('only'), '')!;

        expect(oldest.text).toBe('only');
        expect(recallPrevious(oldest.state, oldest.text)).toBeNull();
    });

    test('stashes the half-typed draft it stepped off', () => {
        expect(recallPrevious(historyOf('first'), 'half typed')!.state.draft).toBe('half typed');
    });

    test('keeps the original draft while walking further back', () => {
        const newest = recallPrevious(historyOf('first', 'second'), 'half typed')!;
        // The recalled text now sits in the input, so that is what a second
        // step back is handed - it must not overwrite the stash.
        const older = recallPrevious(newest.state, newest.text)!;

        expect(older.state.draft).toBe('half typed');
    });
});

describe('recallNext', () => {
    test('returns null while composing rather than browsing', () => {
        expect(recallNext(historyOf('first'))).toBeNull();
    });

    test('walks back toward the present', () => {
        const oldest = recallPrevious(recallPrevious(historyOf('first', 'second'), '')!.state, 'second')!;

        expect(recallNext(oldest.state)!.text).toBe('second');
    });

    test('restores the stashed draft past the newest entry', () => {
        const newest = recallPrevious(historyOf('first'), 'half typed')!;
        const back = recallNext(newest.state)!;

        expect(back.text).toBe('half typed');
        expect(isBrowsing(back.state)).toBe(false);
        expect(recallNext(back.state)).toBeNull();
    });

    test('restores an empty draft when there was nothing typed', () => {
        const newest = recallPrevious(historyOf('first'), '')!;

        expect(recallNext(newest.state)!.text).toBe('');
    });
});

describe('beginDraft', () => {
    test('abandons browsing without touching the entries', () => {
        const browsing = recallPrevious(historyOf('first', 'second'), 'half typed')!;
        const composing = beginDraft(browsing.state);

        expect(composing.entries).toEqual(['first', 'second']);
        expect(isBrowsing(composing)).toBe(false);
        expect(composing.draft).toBe('');
    });

    test('leaves the next step back starting from the newest entry', () => {
        const browsing = recallPrevious(recallPrevious(historyOf('first', 'second'), '')!.state, 'second')!;

        expect(recallPrevious(beginDraft(browsing.state), 'edited')!.text).toBe('second');
    });

    test('is a no-op while already composing', () => {
        const state = historyOf('first');
        expect(beginDraft(state)).toEqual(state);
    });
});
