import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';
import { modelSupportsEffort, type EffortLevel, type SupportedChatModelDefinition } from '@codeyantram/shared';
import { getEffortForModel, setEffortForModel } from '../utils/preferences';
import { useModel } from './model';

// Persisted → model default → undefined. A persisted level is ignored if the
// model no longer supports it (catalog changed, or the model has no effort control at all).
function resolveEffort(model: SupportedChatModelDefinition): EffortLevel | undefined {
    const persisted = getEffortForModel(model.id);
    if (persisted !== undefined && modelSupportsEffort(model, persisted)) return persisted;
    return "defaultEffortLevel" in model ? model.defaultEffortLevel : undefined;
}

type EffortContextValue = {
    effort: EffortLevel | undefined;
    setEffort: (effort: EffortLevel) => void;
};

const EffortContext = createContext<EffortContextValue | null>(null);

export function useEffort(): EffortContextValue {
    const context = useContext(EffortContext);
    if (!context) {
        throw new Error('useEffort must be used within an EffortProvider');
    }
    return context;
}

type EffortProviderProps = {
    children: ReactNode;
};

export function EffortProvider({ children }: EffortProviderProps) {
    const { model } = useModel();
    const [resolvedForModel, setResolvedForModel] = useState(model);
    const [currentEffort, setCurrentEffort] = useState<EffortLevel | undefined>(() =>
        resolveEffort(model),
    );

    // Re-resolve during render (not a useEffect) whenever the selected model
    // changes, so a committed render can never pair the new model with the
    // previous model's effort - an effort level the new model doesn't
    // support must never be carried over, even for one frame. This is
    // React's documented pattern for adjusting state when a prop changes:
    // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
    if (model !== resolvedForModel) {
        setResolvedForModel(model);
        setCurrentEffort(resolveEffort(model));
    }

    const setEffort = useCallback(
        (effort: EffortLevel) => {
            setCurrentEffort(effort);
            setEffortForModel(model.id, effort);
        },
        [model],
    );

    return (
        <EffortContext.Provider value={{ effort: currentEffort, setEffort }}>
            {children}
        </EffortContext.Provider>
    );
}
