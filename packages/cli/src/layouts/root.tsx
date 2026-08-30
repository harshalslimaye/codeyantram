import type { ReactNode } from 'react';
import { ThemeProvider } from '../providers/theme';
import { ModelProvider } from '../providers/model';
import { AgentProvider } from '../providers/agent';
import { KeyboardProvider } from '../providers/keyboard';
import { OverlayProvider } from '../providers/overlay';
import { ToastProvider } from '../providers/toast';
import { ChatProvider } from '../providers/chat';
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
                    <AgentProvider>
                        <ToastProvider>
                            {/* Needs useModel (request payload) and useToast (surfacing stream errors), so it must sit inside both. */}
                            <ChatProvider>
                                <OverlayProvider>
                                    {children}
                                </OverlayProvider>
                            </ChatProvider>
                        </ToastProvider>
                    </AgentProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>
    );
}
