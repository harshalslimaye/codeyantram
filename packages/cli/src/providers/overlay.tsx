import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRenderer } from '@opentui/react';
import type { Renderable } from '@opentui/core';
import { Overlay } from '../components/overlay';

type OverlayContent = {
    title: string;
    body: ReactNode;
};

type OverlayContextValue = {
    /** Shows `body` under `title`, replacing whatever's currently shown. */
    show(title: string, body: ReactNode): void;
    close(): void;
};

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function useOverlay() {
    const context = useContext(OverlayContext);
    if (!context) {
        throw new Error('useOverlay must be used within an OverlayProvider');
    }
    return context;
}

export function OverlayProvider({ children }: { children: ReactNode }) {
    const [content, setContent] = useState<OverlayContent | null>(null);
    const renderer = useRenderer();
    const previouslyFocusedRef = useRef<Renderable | null>(null);

    // The blur/focus handoff lives here, in plain functions called before
    // React ever schedules the content's mount — not in an effect on
    // `Overlay` itself. Content like `OverlayList` self-focuses its own
    // search input via the `focused` prop, and that happens synchronously
    // during commit, strictly before any `useEffect` runs. An effect trying
    // to "save whatever was focused" on `Overlay`'s own mount would instead
    // capture the content's just-focused input, since by the time it ran,
    // that input already *is* the focused thing.
    //
    // Stable identity so consumers holding onto `show`/`close` (e.g. a
    // command's action callback) don't need this in a dependency array.
    const value = useMemo<OverlayContextValue>(() => ({
        show: (title, body) => {
            previouslyFocusedRef.current = renderer.currentFocusedRenderable;
            previouslyFocusedRef.current?.blur();
            setContent({ title, body });
        },
        close: () => {
            setContent(null);

            const target = previouslyFocusedRef.current;
            previouslyFocusedRef.current = null;
            if (!target || target.isDestroyed) return;

            // Deferred by a tick: the overlay's own content unmounts as part
            // of the same state update that clears `content`, and focusing
            // back immediately risks racing whatever the renderer does when
            // tearing that content down.
            setTimeout(() => {
                if (target.isDestroyed) return;
                target.focus();
            }, 1);
        },
    }), [renderer]);

    return (
        <OverlayContext.Provider value={value}>
            {children}
            {content && (
                <Overlay title={content.title} onClose={value.close}>
                    {content.body}
                </Overlay>
            )}
        </OverlayContext.Provider>
    );
}
