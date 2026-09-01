import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';
import { getShowThoughts, setShowThoughts } from '../utils/preferences';

type ReasoningVisibilityContextValue = {
    showThoughts: boolean;
    toggle: () => void;
};

const ReasoningVisibilityContext = createContext<ReasoningVisibilityContextValue | null>(null);

export function useReasoningVisibility(): ReasoningVisibilityContextValue {
    const context = useContext(ReasoningVisibilityContext);
    if (!context) {
        throw new Error('useReasoningVisibility must be used within a ReasoningVisibilityProvider');
    }
    return context;
}

type ReasoningVisibilityProviderProps = {
    children: ReactNode;
};

export function ReasoningVisibilityProvider({ children }: ReasoningVisibilityProviderProps) {
    const [showThoughts, setShowThoughtsState] = useState(() => getShowThoughts() ?? true);

    const toggle = useCallback(() => {
        setShowThoughtsState(prev => {
            const next = !prev;
            setShowThoughts(next);
            return next;
        });
    }, []);

    return (
        <ReasoningVisibilityContext.Provider value={{ showThoughts, toggle }}>
            {children}
        </ReasoningVisibilityContext.Provider>
    );
}
