import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import * as history from '../history';
import type { HistoryState } from '../history';

type HistoryContextValue = {
    /** Submitted prompts, oldest first. */
    entries: readonly string[];
    // A function rather than a value: Phase 4 reads this from inside key and
    // content-change handlers, where a boolean captured at render time can
    // be a keypress out of date. Everything below reads the same ref, so
    // there is one answer and it is always the current one.
    isBrowsing: () => boolean;
    /** Records a submitted prompt as the newest entry and ends browsing. */
    record: (text: string) => void;
    // Both recalls hand back the text the input should now show, or null when
    // there is nothing to move to (already at the oldest entry / already
    // composing) - which is what lets the caller decide whether to swallow
    // the key or let the textarea have it.
    recallPrevious: (currentText: string) => string | null;
    recallNext: () => string | null;
    /** Abandons browsing and goes back to composing - what editing a recalled entry means. */
    beginDraft: () => void;
};

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function useHistory(): HistoryContextValue {
    const context = useContext(HistoryContext);
    if (!context) {
        throw new Error('useHistory must be used within a HistoryProvider');
    }
    return context;
}

type HistoryProviderProps = {
    children: ReactNode;
};

/**
 * Holds this run's prompt history. Nothing is persisted - the list lives for
 * the lifetime of the process.
 *
 * It has to live above the Home/Session swap (see index.tsx): submitting the
 * first message unmounts the Home screen's InputBar and mounts the Session
 * one, so history kept in the input's own state would be lost by the very
 * submission that created it.
 */
export function HistoryProvider({ children }: HistoryProviderProps) {
    const [state, setState] = useState<HistoryState>(history.createHistory);

    // Mirrors `state` synchronously so the handlers below can read and
    // advance the latest history from a key handler without depending on -
    // and being recreated by - `state` itself (same reason as ChatProvider's
    // messagesRef).
    const stateRef = useRef<HistoryState>(state);

    const apply = useCallback((next: HistoryState) => {
        stateRef.current = next;
        setState(next);
    }, []);

    const value = useMemo<HistoryContextValue>(() => ({
        entries: state.entries,
        isBrowsing: () => history.isBrowsing(stateRef.current),
        record: text => apply(history.record(stateRef.current, text)),
        recallPrevious: currentText => {
            const recall = history.recallPrevious(stateRef.current, currentText);
            if (recall === null) return null;

            apply(recall.state);
            return recall.text;
        },
        recallNext: () => {
            const recall = history.recallNext(stateRef.current);
            if (recall === null) return null;

            apply(recall.state);
            return recall.text;
        },
        // Guarded rather than applied unconditionally: Phase 4 calls this on
        // every content change, and re-rendering the whole tree on each
        // keystroke to replace the state with an identical one is work for
        // nothing.
        beginDraft: () => {
            if (!history.isBrowsing(stateRef.current)) return;
            apply(history.beginDraft(stateRef.current));
        },
    // Keyed on the whole state, not just `entries`: stepping through history
    // leaves that array's identity alone, so a narrower dependency would
    // hand consumers a value that never changes and they would never
    // re-render on a step.
    }), [state, apply]);

    return (
        <HistoryContext.Provider value={value}>
            {children}
        </HistoryContext.Provider>
    );
}
