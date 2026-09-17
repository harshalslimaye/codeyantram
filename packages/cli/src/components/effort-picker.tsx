import { TextAttributes } from '@opentui/core';
import { modelHasEffortControl, type EffortLevel } from '@codeyantram/shared';
import { useModelByRole, type ModelRole } from '../providers/model';
import { useEffortByRole } from '../providers/effort';
import { useOverlay } from '../providers/overlay';
import { OverlayList } from './overlay-list';
import { prefixFilter } from '../utils/filter';

/** Serves both roles from one implementation, same as ModelPicker. The empty state is the
 * ordinary case for a worker, not an edge one: DEFAULT_WORKER_MODEL_ID takes no effort
 * parameter at all. */
export function EffortPicker({ role = 'orchestrator' }: { role?: ModelRole } = {}) {
    const { model } = useModelByRole(role);
    const { effort, setEffort } = useEffortByRole(role);
    const overlay = useOverlay();

    if (!modelHasEffortControl(model)) {
        return (
            <box paddingX={1}>
                <text attributes={TextAttributes.DIM}>{model.id} has no adjustable effort level</text>
            </box>
        );
    }

    return (
        <OverlayList
            items={[...model.supportedEffortLevels] as EffortLevel[]}
            getKey={level => level}
            filter={prefixFilter(level => level)}
            isActive={level => level === effort}
            onSelect={level => {
                setEffort(level);
                overlay.close();
            }}
            renderer={(level, { isActive }) => (
                <text>{isActive ? '● ' : '  '}{level}</text>
            )}
            emptyMessage="No effort levels found"
        />
    );
}
