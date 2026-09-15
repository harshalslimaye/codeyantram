import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';
import {
    DEFAULT_CHAT_MODEL_ID,
    findSupportedChatModel,
    type SupportedChatModelDefinition,
} from '@codeyantram/shared';
import { readPreferences, writePreferences } from '../utils/preferences';

const DEFAULT_MODEL = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID) as SupportedChatModelDefinition;

// Only ever checks the static catalog: unlike it, OpenRouter's list is fetched live (see
// model-picker.tsx) and isn't available synchronously at startup. A persisted preference
// pointing at an OpenRouter model falls back to DEFAULT_MODEL here, same as one pointing
// at a since-removed catalog model already did - the picker's own live fetch is what
// actually re-offers it once mounted, the user just has to reselect it once per restart.
export function getInitialModel(): SupportedChatModelDefinition {
    const preferences = readPreferences();
    if (preferences.modelId === undefined) return DEFAULT_MODEL;

    return findSupportedChatModel(preferences.modelId) ?? DEFAULT_MODEL;
}

function persistModel(model: SupportedChatModelDefinition): void {
    writePreferences({ modelId: model.id });
}

type ModelContextValue = {
    model: SupportedChatModelDefinition;
    setModel: (model: SupportedChatModelDefinition) => void;
};

const ModelContext = createContext<ModelContextValue | null>(null);

export function useModel(): ModelContextValue {
    const context = useContext(ModelContext);
    if (!context) {
        throw new Error('useModel must be used within a ModelProvider');
    }
    return context;
}

type ModelProviderProps = {
    children: ReactNode;
};

export function ModelProvider({ children }: ModelProviderProps) {
    const [currentModel, setCurrentModel] = useState<SupportedChatModelDefinition>(() => getInitialModel());

    const setModel = useCallback((model: SupportedChatModelDefinition) => {
        setCurrentModel(model);
        persistModel(model);
    }, []);

    return (
        <ModelContext.Provider value={{ model: currentModel, setModel }}>
            {children}
        </ModelContext.Provider>
    );
}
