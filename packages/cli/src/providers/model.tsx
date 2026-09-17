import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';
import {
    DEFAULT_CHAT_MODEL_ID,
    DEFAULT_WORKER_MODEL_ID,
    findSupportedChatModel,
    type SupportedChatModelDefinition,
} from '@codeyantram/shared';
import { readPreferences, writePreferences } from '../utils/preferences';

/**
 * The two model choices a turn carries: the one the assistant itself runs on, and the one
 * its subagent workers run on (see the explore tool). Separate choices over the same
 * catalog - a worker may be any model the orchestrator may be, including the same one.
 */
export type ModelRole = 'orchestrator' | 'worker';

const ROLE_CONFIG = {
    orchestrator: { preferenceKey: 'modelId', defaultId: DEFAULT_CHAT_MODEL_ID },
    worker: { preferenceKey: 'workerModelId', defaultId: DEFAULT_WORKER_MODEL_ID },
} as const satisfies Record<ModelRole, { preferenceKey: 'modelId' | 'workerModelId'; defaultId: string }>;

// Only ever checks the static catalog: unlike it, OpenRouter's list is fetched live (see
// model-picker.tsx) and isn't available synchronously at startup. A persisted preference
// pointing at an OpenRouter model falls back to the role's default here, same as one
// pointing at a since-removed catalog model already did - the picker's own live fetch is
// what actually re-offers it once mounted, the user just has to reselect it once per
// restart.
export function getInitialModel(role: ModelRole = 'orchestrator'): SupportedChatModelDefinition {
    const { preferenceKey, defaultId } = ROLE_CONFIG[role];
    const fallback = findSupportedChatModel(defaultId) as SupportedChatModelDefinition;

    const persisted = readPreferences()[preferenceKey];
    if (persisted === undefined) return fallback;

    return findSupportedChatModel(persisted) ?? fallback;
}

type ModelContextValue = {
    model: SupportedChatModelDefinition;
    setModel: (model: SupportedChatModelDefinition) => void;
};

const OrchestratorContext = createContext<ModelContextValue | null>(null);
const WorkerContext = createContext<ModelContextValue | null>(null);

const ROLE_CONTEXTS = {
    orchestrator: OrchestratorContext,
    worker: WorkerContext,
} as const satisfies Record<ModelRole, React.Context<ModelContextValue | null>>;

function useModelForRole(role: ModelRole): ModelContextValue {
    const context = useContext(ROLE_CONTEXTS[role]);
    if (!context) {
        throw new Error('useModel must be used within a ModelProvider');
    }
    return context;
}

export function useModel(): ModelContextValue {
    return useModelForRole('orchestrator');
}

export function useWorkerModel(): ModelContextValue {
    return useModelForRole('worker');
}

/** Reads whichever of the two a component is parameterized over - used by the pickers,
 * which are one component serving both roles rather than two that would drift apart. */
export function useModelByRole(role: ModelRole): ModelContextValue {
    return useModelForRole(role);
}

type ModelProviderProps = {
    children: ReactNode;
};

function RoleModelProvider({ role, children }: { role: ModelRole; children: ReactNode }) {
    const [currentModel, setCurrentModel] = useState<SupportedChatModelDefinition>(() => getInitialModel(role));

    const setModel = useCallback(
        (model: SupportedChatModelDefinition) => {
            setCurrentModel(model);
            writePreferences({ [ROLE_CONFIG[role].preferenceKey]: model.id });
        },
        [role],
    );

    const Context = ROLE_CONTEXTS[role];

    return <Context.Provider value={{ model: currentModel, setModel }}>{children}</Context.Provider>;
}

/** Mounts both roles, so `useModel()` and `useWorkerModel()` are available together and a
 * caller never has to know there are two providers. */
export function ModelProvider({ children }: ModelProviderProps) {
    return (
        <RoleModelProvider role="orchestrator">
            <RoleModelProvider role="worker">{children}</RoleModelProvider>
        </RoleModelProvider>
    );
}
