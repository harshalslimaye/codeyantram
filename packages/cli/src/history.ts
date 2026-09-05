// The prompts the user has submitted this run, and where they currently are
// while walking back through them. Pure state transitions, kept apart from
// the provider that owns them (same split as keyboard.ts) so the awkward
// parts - clamping at the ends, stashing the half-typed draft - are testable
// without rendering anything.
//
// Nothing here is persisted: the list lives for the lifetime of the process
// and goes away with it.

/** Past this many entries the oldest are dropped, so a long session can't grow the list without bound. */
export const MAX_HISTORY_ENTRIES = 100;

export type HistoryState = {
    /** Submitted prompts, oldest first. */
    entries: string[];
    // Where the user is while browsing. An index into `entries`, except for
    // the one-past-the-end value (`entries.length`), which means "not
    // browsing - composing a new prompt". Deriving "is browsing" from this
    // rather than tracking it separately is what keeps the two from
    // disagreeing.
    cursor: number;
    // The half-typed prompt that browsing interrupted, stashed when the user
    // steps off the draft position and handed back when they return to it.
    // Empty whenever `cursor` is at that position, since there's nothing to
    // come back to yet.
    draft: string;
};

export function createHistory(): HistoryState {
    return { entries: [], cursor: 0, draft: '' };
}

/** Whether `state` is sitting on a recalled entry rather than on the user's own draft. */
export function isBrowsing(state: HistoryState): boolean {
    return state.cursor < state.entries.length;
}

/**
 * Records a submitted prompt as the newest entry and ends browsing.
 *
 * A prompt identical to the one before it isn't stored twice (bash's
 * `ignoredups`), but submitting it still ends browsing - the user is back to
 * composing either way. Empty text is not a submission at all and leaves
 * `state` untouched.
 */
export function record(state: HistoryState, text: string): HistoryState {
    const trimmed = text.trim();
    if (trimmed === '') return state;

    const isDuplicate = state.entries[state.entries.length - 1] === trimmed;
    const appended = isDuplicate ? state.entries : [...state.entries, trimmed];
    // Dropping from the front keeps the newest entries, which are the ones
    // worth recalling; `cursor` is set from the trimmed length below, so it
    // can't be left pointing past the end.
    const entries = appended.length > MAX_HISTORY_ENTRIES ? appended.slice(-MAX_HISTORY_ENTRIES) : appended;

    return { entries, cursor: entries.length, draft: '' };
}

export type Recall = {
    state: HistoryState;
    /** What the input should now contain. */
    text: string;
};

/**
 * Steps one entry further back, or returns null when there's nothing older to
 * step to - so the caller can tell "recalled something" from "already at the
 * oldest entry" and decide for itself whether to swallow the key.
 *
 * `currentText` is whatever is in the input right now. It's only read when
 * stepping off the draft position, which is the moment - and the only moment
 * - there's an unsubmitted prompt worth stashing.
 */
export function recallPrevious(state: HistoryState, currentText: string): Recall | null {
    if (state.cursor === 0) return null;

    const draft = isBrowsing(state) ? state.draft : currentText;
    const cursor = state.cursor - 1;

    return {
        state: { entries: state.entries, cursor, draft },
        text: state.entries[cursor] ?? '',
    };
}

/**
 * Steps one entry back toward the present, returning the stashed draft once it
 * lands past the newest entry. Null when already on the draft - there is
 * nothing newer to move to.
 */
export function recallNext(state: HistoryState): Recall | null {
    if (!isBrowsing(state)) return null;

    const cursor = state.cursor + 1;
    // The draft is left in place rather than cleared here: the next step back
    // re-stashes whatever the input holds anyway, so clearing it would only
    // add a way for the two to disagree.
    return {
        state: { ...state, cursor },
        text: cursor === state.entries.length ? state.draft : (state.entries[cursor] ?? ''),
    };
}

/**
 * Abandons browsing and goes back to composing - what editing a recalled entry
 * (and clearing the input) means. Takes no text: the draft is stashed lazily
 * by recallPrevious, so there is nothing to hand over here, only a stale stash
 * to drop.
 */
export function beginDraft(state: HistoryState): HistoryState {
    return { entries: state.entries, cursor: state.entries.length, draft: '' };
}
