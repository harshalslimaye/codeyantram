import type { ReactNode } from 'react';
import { ThemeProvider } from '../providers/theme';
import { ModelProvider } from '../providers/model';
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
                <ModelProvider>
                    <ToastProvider>
                        <OverlayProvider>
                            {children}
                        </OverlayProvider>
                    </ToastProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>
    );
}
