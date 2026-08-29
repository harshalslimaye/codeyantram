import { useEffect, type ReactNode } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { RGBA, TextAttributes } from '@opentui/core';
import { useTheme } from '../providers/theme';
import { useLayerStack } from '../providers/keyboard';

type OverlayProps = {
    title: string;
    onClose: () => void;
    children: ReactNode;
};

/**
 * The overlay shell: backdrop, centered panel, title/esc header, and the
 * generic mechanics of being an overlay (owning the keyboard while shown,
 * closing on escape/ctrl+c). Everything below the header — search, lists,
 * static text — is `children`'s job; this component never looks inside it.
 *
 * Deliberately does not manage focus itself: content like `OverlayList`
 * self-focuses its own search input via the `focused` prop, and that prop is
 * applied synchronously during React's commit — strictly before any
 * `useEffect` in this component (or anywhere) runs. An effect here trying to
 * "save and blur whatever was focused before" would instead capture and blur
 * the content's own just-focused input, since by the time it runs, that
 * input already *is* the focused thing. `OverlayProvider.show`/`close` do
 * this instead, since they run before the content ever mounts.
 */
export function Overlay({ title, onClose, children }: OverlayProps) {
    const { colors } = useTheme();
    const layers = useLayerStack();
    const dimensions = useTerminalDimensions();

    // Overlay is only ever mounted while there's content to show — the
    // provider renders it conditionally rather than toggling a prop — so its
    // mount lifetime already matches "the overlay is open," and claiming on
    // mount / releasing on unmount is enough.
    useEffect(() => layers.push('overlay'), [layers]);

    useKeyboard(key => {
        if (!layers.isOnTop('overlay')) return;

        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
            key.preventDefault();
            onClose();
        }
    });

    return (
        <box
            position="absolute"
            top={0}
            left={0}
            width={dimensions.width}
            height={dimensions.height}
            zIndex={100}
            alignItems="center"
            justifyContent="center"
            backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
        >
            <box backgroundColor={colors.panel} width={70} maxWidth={dimensions.width - 4} paddingX={2} paddingY={1}>
                <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
                    <text attributes={TextAttributes.BOLD}>{title}</text>
                    <text attributes={TextAttributes.DIM}>esc</text>
                </box>
                {children}
            </box>
        </box>
    );
}
