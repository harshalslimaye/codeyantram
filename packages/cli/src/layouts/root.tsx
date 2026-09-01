import type { ReactNode } from 'react';
import { ThemeProvider } from '../providers/theme';
import { ModelProvider } from '../providers/model';
import { EffortProvider } from '../providers/effort';
import { AgentProvider } from '../providers/agent';
import { ReasoningVisibilityProvider } from '../providers/reasoning-visibility';
import { KeyboardProvider } from '../providers/keyboard';
import { OverlayProvider } from '../providers/overlay';
import { ToastProvider } from '../providers/toast';
import { ChatProvider } from '../providers/chat';
import { ApprovalOverlay } from '../components/approval-overlay';
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
                    <EffortProvider>
                        <AgentProvider>
                            <ReasoningVisibilityProvider>
                                <ToastProvider>
                                    {/* Needs useModel/useEffort (request payload) and useToast (surfacing stream errors), so it must sit inside all three. */}
                                    <ChatProvider>
                                        <OverlayProvider>
                                            {children}
                                        </OverlayProvider>
                                        <ApprovalOverlay />
                                    </ChatProvider>
                                </ToastProvider>
                            </ReasoningVisibilityProvider>
                        </AgentProvider>
                    </EffortProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>
    );
}
