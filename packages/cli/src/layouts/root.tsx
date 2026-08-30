import type { ReactNode } from 'react';
import { ThemeProvider } from '../providers/theme';
import { KeyboardProvider } from '../providers/keyboard';
import { OverlayProvider } from '../providers/overlay';
import { ToastProvider } from '../providers/toast';
import type { LayerStack } from '../keyboard';

type RootProps = {
    layers: LayerStack;
    children: ReactNode;
};

export function Root({ layers, children }: RootProps) {
    return (
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ToastProvider>
                    <OverlayProvider>
                        {children}
                    </OverlayProvider>
                </ToastProvider>
            </ThemeProvider>
        </KeyboardProvider>
    );
}
