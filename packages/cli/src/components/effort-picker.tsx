import { TextAttributes } from '@opentui/core';
import { modelHasEffortControl, type EffortLevel } from '@codeyantram/shared';
import { useModel } from '../providers/model';
import { useEffort } from '../providers/effort';
import { useOverlay } from '../providers/overlay';
import { OverlayList } from './overlay-list';
import { prefixFilter } from '../utils/filter';

export function EffortPicker() {
    const { model } = useModel();
    const { effort, setEffort } = useEffort();
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
