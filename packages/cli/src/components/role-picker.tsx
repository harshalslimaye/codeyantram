import { TextAttributes } from '@opentui/core';
import type { ReactNode } from 'react';
import { useModel, useWorkerModel, type ModelRole } from '../providers/model';
import { useEffort, useWorkerEffort } from '../providers/effort';
import { useOverlay } from '../providers/overlay';
import { OverlayList } from './overlay-list';
import { prefixFilter } from '../utils/filter';

type Row = {
    role: ModelRole;
    label: string;
    /** That role's current setting, shown on its own row - so this screen says what is
     * configured rather than only where to go, and is the one place the two-model setup is
     * visible at a glance. */
    current: string;
    body: ReactNode;
};

/**
 * The first step of /models and /effort: which of the two models this is about.
 *
 * A submenu rather than four top-level commands. Both settings exist twice now - once for
 * the assistant itself, once for the subagent workers it spawns - and doubling the command
 * list to say so would push the other commands down for a choice most users make once.
 */
function RolePicker({ rows }: { rows: Row[] }) {
    const overlay = useOverlay();

    return (
        <OverlayList
            items={rows}
            getKey={row => row.role}
            filter={prefixFilter(row => row.label)}
            onSelect={row => overlay.show(row.label, row.body)}
            renderer={(row: Row) => (
                <box flexDirection="row" gap={1}>
                    <text>{row.label}</text>
                    <text attributes={TextAttributes.DIM}>{row.current}</text>
                </box>
            )}
            emptyMessage="No roles found"
        />
    );
}

/** Built here rather than in commands.tsx so the current-value lookups stay inside a
 * component that can use the providers' hooks. */
export function ModelRoleMenu({ orchestrator, worker }: { orchestrator: ReactNode; worker: ReactNode }) {
    const { model } = useModel();
    const { model: workerModel } = useWorkerModel();

    return (
        <RolePicker
            rows={[
                { role: 'orchestrator', label: 'Orchestrator', current: model.id, body: orchestrator },
                { role: 'worker', label: 'Worker', current: workerModel.id, body: worker },
            ]}
        />
    );
}

export function EffortRoleMenu({ orchestrator, worker }: { orchestrator: ReactNode; worker: ReactNode }) {
    const { model } = useModel();
    const { model: workerModel } = useWorkerModel();
    const { effort } = useEffort();
    const { effort: workerEffort } = useWorkerEffort();

    // "none" rather than the level, for a model that takes no effort parameter at all -
    // which is the default worker's case, so this row is usually the empty one.
    const describe = (level: string | undefined, modelId: string) => (level === undefined ? `${modelId} · n/a` : `${modelId} · ${level}`);

    return (
        <RolePicker
            rows={[
                {
                    role: 'orchestrator',
                    label: 'Orchestrator Effort',
                    current: describe(effort, model.id),
                    body: orchestrator,
                },
                { role: 'worker', label: 'Worker Effort', current: describe(workerEffort, workerModel.id), body: worker },
            ]}
        />
    );
}
