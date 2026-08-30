import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';
import { AGENTS, DEFAULT_AGENT, type Agent } from '../agents';
import { readPreferences, writePreferences } from '../utils/preferences';

export function getInitialAgent(): Agent {
    const preferences = readPreferences();
    if (preferences.agentName === undefined) return DEFAULT_AGENT;

    // Falls back to the default if the saved name no longer exists in the
    // catalog (e.g. the agent was removed or renamed since it was saved).
    return AGENTS.find(agent => agent.name === preferences.agentName) ?? DEFAULT_AGENT;
}

function persistAgent(agent: Agent): void {
    writePreferences({ agentName: agent.name });
}

type AgentContextValue = {
    agent: Agent;
    setAgent: (agent: Agent) => void;
};

const AgentContext = createContext<AgentContextValue | null>(null);

export function useAgent(): AgentContextValue {
    const context = useContext(AgentContext);
    if (!context) {
        throw new Error('useAgent must be used within an AgentProvider');
    }
    return context;
}

type AgentProviderProps = {
    children: ReactNode;
};

export function AgentProvider({ children }: AgentProviderProps) {
    const [currentAgent, setCurrentAgent] = useState<Agent>(() => getInitialAgent());

    const setAgent = useCallback((agent: Agent) => {
        setCurrentAgent(agent);
        persistAgent(agent);
    }, []);

    return (
        <AgentContext.Provider value={{ agent: currentAgent, setAgent }}>
            {children}
        </AgentContext.Provider>
    );
}
