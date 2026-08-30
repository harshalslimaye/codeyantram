import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';
import {
    DEFAULT_CHAT_MODEL_ID,
    findSupportedChatModel,
    type SupportedChatModel,
} from '@codeyantram/shared';
import { readPreferences, writePreferences } from '../utils/preferences';

const DEFAULT_MODEL = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID) as SupportedChatModel;

export function getInitialModel(): SupportedChatModel {
    const preferences = readPreferences();
    if (preferences.modelId === undefined) return DEFAULT_MODEL;

    // Falls back to the default if the saved id no longer exists in the
    // catalog (e.g. the model was removed or renamed since it was saved).
    return findSupportedChatModel(preferences.modelId) ?? DEFAULT_MODEL;
}

function persistModel(model: SupportedChatModel): void {
    writePreferences({ modelId: model.id });
}

type ModelContextValue = {
    model: SupportedChatModel;
    setModel: (model: SupportedChatModel) => void;
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
    const [currentModel, setCurrentModel] = useState<SupportedChatModel>(() => getInitialModel());

    const setModel = useCallback((model: SupportedChatModel) => {
        setCurrentModel(model);
        persistModel(model);
    }, []);

    return (
        <ModelContext.Provider value={{ model: currentModel, setModel }}>
            {children}
        </ModelContext.Provider>
    );
}
