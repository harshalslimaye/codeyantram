import { AGENTS, type Agent } from '../agents';
import { useAgent } from '../providers/agent';
import { useOverlay } from '../providers/overlay';
import { OverlayList } from './overlay-list';
import { prefixFilter } from '../utils/filter';

export function AgentPicker() {
    const { agent, setAgent } = useAgent();
    const overlay = useOverlay();

    return (
        <OverlayList
            items={AGENTS}
            getKey={a => a.name}
            filter={prefixFilter(a => a.name)}
            isActive={a => a.name === agent.name}
            onSelect={a => {
                setAgent(a);
                overlay.close();
            }}
            renderer={(a: Agent, { isActive }) => (
                <text>{isActive ? '● ' : '  '}{a.name}</text>
            )}
            emptyMessage="No agents found"
        />
    );
}
