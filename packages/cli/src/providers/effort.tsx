import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';
import { modelSupportsEffort, type EffortLevel, type SupportedChatModelDefinition } from '@codeyantram/shared';
import { getEffortForModel, setEffortForModel } from '../utils/preferences';
import { useModelByRole, type ModelRole } from './model';

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

const OrchestratorContext = createContext<EffortContextValue | null>(null);
const WorkerContext = createContext<EffortContextValue | null>(null);

const ROLE_CONTEXTS = {
    orchestrator: OrchestratorContext,
    worker: WorkerContext,
} as const satisfies Record<ModelRole, React.Context<EffortContextValue | null>>;

function useEffortForRole(role: ModelRole): EffortContextValue {
    const context = useContext(ROLE_CONTEXTS[role]);
    if (!context) {
        throw new Error('useEffort must be used within an EffortProvider');
    }
    return context;
}

export function useEffort(): EffortContextValue {
    return useEffortForRole('orchestrator');
}

export function useWorkerEffort(): EffortContextValue {
    return useEffortForRole('worker');
}

/** Reads whichever role a component is parameterized over - used by EffortPicker, which
 * serves both. */
export function useEffortByRole(role: ModelRole): EffortContextValue {
    return useEffortForRole(role);
}

type EffortProviderProps = {
    children: ReactNode;
};

/**
 * One role's effort level, derived from that role's own selected model.
 *
 * Note that both roles read and write the same `effortByModel` map, keyed by model id -
 * not by role. That is deliberate: effort is a property of the model, not of what the
 * model is being used for, so setting the two roles to the same model means they share one
 * value. Keying by role instead would let the same model carry two different levels, which
 * is a distinction without a meaning.
 */
function RoleEffortProvider({ role, children }: { role: ModelRole; children: ReactNode }) {
    const { model } = useModelByRole(role);
    const [resolvedForModel, setResolvedForModel] = useState(model);
    const [currentEffort, setCurrentEffort] = useState<EffortLevel | undefined>(() => resolveEffort(model));

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

    const Context = ROLE_CONTEXTS[role];

    return <Context.Provider value={{ effort: currentEffort, setEffort }}>{children}</Context.Provider>;
}

/** Mounts both roles, mirroring ModelProvider - a caller never has to know there are two. */
export function EffortProvider({ children }: EffortProviderProps) {
    return (
        <RoleEffortProvider role="orchestrator">
            <RoleEffortProvider role="worker">{children}</RoleEffortProvider>
        </RoleEffortProvider>
    );
}
