import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useKeyboard } from '@opentui/react';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '../providers/theme';
import { useLayerStack } from '../providers/keyboard';

export type OverlayListItemState = {
    /** The keyboard cursor is on this row. */
    isSelected: boolean;
    /** This row is the current value (e.g. the active theme), independent of `isSelected`. */
    isActive: boolean;
};

type OverlayListProps<T> = {
    items: T[];
    getKey: (item: T) => string;
    /** Whether `item` matches the current search text. */
    filter: (item: T, query: string) => boolean;
    onSelect: (item: T) => void;
    renderer: (item: T, state: OverlayListItemState) => ReactNode;
    /** Marks a row as the current value; defaults to none. */
    isActive?: (item: T) => boolean;
    placeholder?: string;
    maxVisible?: number;
    /** Shown in place of the list when the search text matches nothing. */
    emptyMessage?: string;
    /** Optional ctrl+d handler for the highlighted row - only the session picker uses
     * this today, so it's opt-in rather than a capability every list gets for free. A
     * dedicated modifier chord, not a bare key, since the search box is always focused
     * and a bare key would either type into it or double as some other list action. Shows
     * a "ctrl+d delete" hint next to the search box only when provided. */
    onDelete?: (item: T) => void;
    /** Optional ctrl+r handler for the highlighted row - same reasoning and shape as
     * onDelete above, just a different chord for a different action. Shows a
     * "ctrl+r rename" hint next to onDelete's own when provided. */
    onRename?: (item: T) => void;
    /** Overrides the word shown after "ctrl+d" in onDelete's hint - e.g. "clear" for a
     * list where the action removes a value rather than deleting an item outright.
     * Defaults to 'delete', so /sessions' existing hint is unchanged. */
    deleteLabel?: string;
};

/**
 * The list-content primitive for `Overlay`: a search box plus a filtered,
 * scrollable, keyboard-navigable list. Composed inside an `Overlay`, never
 * by it — `Overlay` has no idea this exists.
 */
export function OverlayList<T>({
    items,
    getKey,
    filter,
    onSelect,
    renderer,
    isActive,
    placeholder = 'Search',
    maxVisible = 6,
    emptyMessage = 'No results',
    onDelete,
    onRename,
    deleteLabel = 'delete',
}: OverlayListProps<T>) {
    const { colors } = useTheme();
    const layers = useLayerStack();
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    const filtered = items.filter(item => filter(item, query));

    const scrollOffsetRef = useRef(0);
    if (filtered.length <= maxVisible) {
        scrollOffsetRef.current = 0;
    } else if (selectedIndex < scrollOffsetRef.current) {
        scrollOffsetRef.current = selectedIndex;
    } else if (selectedIndex > scrollOffsetRef.current + maxVisible - 1) {
        scrollOffsetRef.current = selectedIndex - maxVisible + 1;
    }
    const scrollOffset = Math.max(0, Math.min(scrollOffsetRef.current, Math.max(0, filtered.length - maxVisible)));
    const visibleItems = filtered.slice(scrollOffset, scrollOffset + maxVisible);

    // Reset the highlighted row whenever the filtered set changes shape —
    // same reasoning as Autocomplete: an index that pointed at "gruvbox"
    // before a keystroke may point at something else, or nothing, after it.
    const filteredKey = filtered.map(getKey).join(' ');
    useEffect(() => {
        setSelectedIndex(0);
        scrollOffsetRef.current = 0;
    }, [filteredKey]);

    useKeyboard(key => {
        if (!layers.isOnTop('overlay')) return;
        if (filtered.length === 0) return;

        if (onDelete !== undefined && key.ctrl && key.name === 'd') {
            key.preventDefault();
            const item = filtered[selectedIndex];
            if (item) onDelete(item);
            return;
        }

        if (onRename !== undefined && key.ctrl && key.name === 'r') {
            key.preventDefault();
            const item = filtered[selectedIndex];
            if (item) onRename(item);
            return;
        }

        switch (key.name) {
            case 'up':
                key.preventDefault();
                setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length);
                break;
            case 'down':
                key.preventDefault();
                setSelectedIndex(i => (i + 1) % filtered.length);
                break;
            case 'return': {
                key.preventDefault();
                const item = filtered[selectedIndex];
                if (item) onSelect(item);
                break;
            }
            default:
                break;
        }
    });

    return (
        <box>
            <box flexDirection="row" justifyContent="space-between">
                <input focused flexGrow={1} value={query} onInput={setQuery} placeholder={placeholder} />
                <box flexDirection="row" gap={1}>
                    {onRename !== undefined && (
                        <text attributes={TextAttributes.DIM}>ctrl+r rename</text>
                    )}
                    {onDelete !== undefined && (
                        <text attributes={TextAttributes.DIM}>ctrl+d {deleteLabel}</text>
                    )}
                </box>
            </box>
            <box marginTop={1}>
                {filtered.length === 0 ? (
                    <box paddingX={1}>
                        <text attributes={TextAttributes.DIM}>{emptyMessage}</text>
                    </box>
                ) : (
                    <>
                        {scrollOffset > 0 && (
                            <box paddingX={1}>
                                <text attributes={TextAttributes.DIM}>▲</text>
                            </box>
                        )}
                        {visibleItems.map((item, i) => {
                            const index = scrollOffset + i;
                            const isSelected = index === selectedIndex;
                            return (
                                <box key={getKey(item)} backgroundColor={isSelected ? colors.accent : undefined} paddingX={1}>
                                    {renderer(item, { isSelected, isActive: isActive?.(item) ?? false })}
                                </box>
                            );
                        })}
                        {scrollOffset + maxVisible < filtered.length && (
                            <box paddingX={1}>
                                <text attributes={TextAttributes.DIM}>▼</text>
                            </box>
                        )}
                    </>
                )}
            </box>
        </box>
    );
}
