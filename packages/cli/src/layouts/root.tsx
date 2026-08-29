import type { ReactNode } from 'react';
import { ThemeProvider } from '../providers/theme';
import { KeyboardProvider } from '../providers/keyboard';
import type { LayerStack } from '../keyboard';

type RootProps = {
    layers: LayerStack;
    children: ReactNode;
};

export function Root({ layers, children }: RootProps) {
    return (
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                {children}
            </ThemeProvider>
        </KeyboardProvider>
    );
}