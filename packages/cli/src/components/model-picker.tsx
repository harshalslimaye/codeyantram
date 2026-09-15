import { useEffect, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { SUPPORTED_CHAT_MODELS, type SupportedChatModelDefinition } from '@codeyantram/shared';
import { useModel } from '../providers/model';
import { useOverlay } from '../providers/overlay';
import { OverlayList } from './overlay-list';
import { Spinner } from './spinner';
import { prefixFilter } from '../utils/filter';
import { fetchOpenRouterModels, ModelsApiError } from '../api/models';

export function ModelPicker() {
    const { model, setModel } = useModel();
    const overlay = useOverlay();
    // The static catalog renders instantly (SUPPORTED_CHAT_MODELS is known at build
    // time); OpenRouter's is fetched live and merged in once it lands, rather than
    // blocking the picker on a network call the other four providers never needed.
    const [openRouterModels, setOpenRouterModels] = useState<SupportedChatModelDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        fetchOpenRouterModels()
            .then(models => {
                if (!cancelled) setOpenRouterModels(models);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setLoadError(error instanceof ModelsApiError ? error.message : 'Failed to load OpenRouter models');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const models: SupportedChatModelDefinition[] = [...SUPPORTED_CHAT_MODELS, ...openRouterModels];

    return (
        <box>
            {loading && (
                <box paddingX={1} marginBottom={1}>
                    <Spinner label="Loading OpenRouter models…" />
                </box>
            )}
            {loadError !== null && (
                <box paddingX={1} marginBottom={1}>
                    <text attributes={TextAttributes.DIM}>Couldn't load OpenRouter models: {loadError}</text>
                </box>
            )}
            <OverlayList
                items={models}
                getKey={m => m.id}
                filter={prefixFilter(m => m.id)}
                isActive={m => m.id === model.id}
                onSelect={m => {
                    setModel(m);
                    overlay.close();
                }}
                renderer={(m: SupportedChatModelDefinition, { isActive }) => (
                    <box flexDirection="row" gap={1}>
                        <text>{isActive ? '● ' : '  '}{m.id}</text>
                        <text attributes={TextAttributes.DIM}>{m.provider}</text>
                    </box>
                )}
                emptyMessage="No models found"
            />
        </box>
    );
}
