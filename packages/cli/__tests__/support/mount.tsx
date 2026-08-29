import type { ReactNode } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { ThemeProvider } from '../../src/providers/theme';

/**
 * Mounts `node` with enough surrounding layout for a `position: "absolute";
 * bottom: "100%"` dropup (like Autocomplete's) to actually be visible:
 * a relative-positioned container, an anchor below it to give that
 * container real height, and headroom above for the dropup to render into.
 * Mirrors how InputBar wraps Autocomplete in the real app.
 */
export function mountDropup(node: ReactNode, options?: { width?: number; height?: number }) {
    const width = options?.width ?? 40;
    const height = options?.height ?? 30;

    return testRender(
        <ThemeProvider>
            <box paddingTop={15} width={width}>
                <box position="relative" width={width}>
                    {node}
                    <box height={3}>
                        <text>anchor</text>
                    </box>
                </box>
            </box>
        </ThemeProvider>,
        { width, height }
    );
}

// A real (not zero-delay) macrotask yield. Needed between key presses that
// update React state read by a later key's handler closure — see the
// __tests__/components/autocomplete.test.tsx header comment for why.
export const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

// KeyCodes.ESCAPE is a bare `\x1B` byte, which is also the prefix of every
// multi-byte escape sequence (arrow keys, etc). The key parser holds it for
// a short disambiguation window before emitting a plain "escape" — waiting
// less than that window means the event hasn't fired yet.
export const settleEscape = () => tick(100);
