import { TextAttributes } from '@opentui/core';
import { SUPPORTED_CHAT_MODELS, type SupportedChatModel } from '@codeyantram/shared';
import { useModel } from '../providers/model';
import { useOverlay } from '../providers/overlay';
import { OverlayList } from './overlay-list';
import { prefixFilter } from '../utils/filter';

export function ModelPicker() {
    const { model, setModel } = useModel();
    const overlay = useOverlay();

    return (
        <OverlayList
            items={SUPPORTED_CHAT_MODELS}
            getKey={m => m.id}
            filter={prefixFilter(m => m.id)}
            isActive={m => m.id === model.id}
            onSelect={m => {
                setModel(m);
                overlay.close();
            }}
            renderer={(m: SupportedChatModel, { isActive }) => (
                <box flexDirection="row" gap={1}>
                    <text>{isActive ? '● ' : '  '}{m.id}</text>
                    <text attributes={TextAttributes.DIM}>{m.provider}</text>
                </box>
            )}
            emptyMessage="No models found"
        />
    );
}
