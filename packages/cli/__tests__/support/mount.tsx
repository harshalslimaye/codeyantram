import type { ReactNode } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { ThemeProvider } from '../../src/providers/theme';
import { ModelProvider } from '../../src/providers/model';
import { AgentProvider } from '../../src/providers/agent';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { OverlayProvider } from '../../src/providers/overlay';
import { ToastProvider } from '../../src/providers/toast';
import { createLayerStack } from '../../src/keyboard';

/**
 * Mounts `node` with enough surrounding layout for a `position: "absolute";
 * bottom: "100%"` dropup (like Autocomplete's) to actually be visible:
 * a relative-positioned container, an anchor below it to give that
 * container real height, and headroom above for the dropup to render into.
 * Mirrors how Root and InputBar wrap Autocomplete in the real app, including
 * the KeyboardProvider that layer-claiming components now require, the
 * OverlayProvider that CommandMenu now reads (its `/themes`, `/models`, and
 * `/agents` commands each open one), the ThemeProvider, ModelProvider, and
 * AgentProvider those overlays' contents read from, and the ToastProvider
 * that overlay content can reach via `useToast()`. Hands back the layer
 * stack it created so a test can assert on ownership.
 */
// @opentui/core destroys the renderer on any ctrl+c by default
// (`exitOnCtrlC`), independent of whatever key handlers a component
// registers. `src/index.tsx` turns that off so the app's own layered ctrl+c
// handling is the only thing deciding what ctrl+c does — every test renderer
// needs the same override, or a ctrl+c press in a test would quit for real
// regardless of what the component under test actually did with it.
export const NO_BUILTIN_CTRL_C = { exitOnCtrlC: false } as const;

export function mountDropup(node: ReactNode, options?: { width?: number; height?: number }) {
    const width = options?.width ?? 40;
    const height = options?.height ?? 30;
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ModelProvider>
                    <AgentProvider>
                        <ToastProvider>
                            <OverlayProvider>
                                <box paddingTop={15} width={width}>
                                    <box position="relative" width={width}>
                                        {node}
                                        <box height={3}>
                                            <text>anchor</text>
                                        </box>
                                    </box>
                                </box>
                            </OverlayProvider>
                        </ToastProvider>
                    </AgentProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

/**
 * Mounts `node` under a real layer stack, and hands it back so a test can
 * assert on ownership directly.
 */
export function renderWithKeyboard(node: ReactNode, options?: { width?: number; height?: number }) {
    const width = options?.width ?? 60;
    const height = options?.height ?? 20;
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            {node}
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
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
