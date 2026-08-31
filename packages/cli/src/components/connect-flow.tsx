import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { TextAttributes } from '@opentui/core';
import {
    SUPPORTED_PROVIDERS,
    getConfiguredProviders,
    writeAuthKey,
    removeAuthKey,
    type SupportedProvider,
} from '@codeyantram/shared';
import { useOverlay } from '../providers/overlay';
import { useToast } from '../providers/toast';
import { useLayerStack } from '../providers/keyboard';
import { OverlayList } from './overlay-list';
import { prefixFilter } from '../utils/filter';

const PROVIDER_LABELS: Record<SupportedProvider, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    deepseek: 'DeepSeek',
};

type ConnectFormProps = {
    provider: SupportedProvider;
    isConfigured: boolean;
    onSaved: (provider: SupportedProvider) => void;
    onCleared: (provider: SupportedProvider) => void;
};

// Exported for direct testing: it takes no context, only props, so its three
// submit branches (save / clear / no-op-on-blank-when-unconfigured) are
// cleanly testable without needing a real disk round-trip through ConnectFlow.
export function ConnectForm({ provider, isConfigured, onSaved, onCleared }: ConnectFormProps) {
    const [value, setValue] = useState('');
    const layers = useLayerStack();

    // `<input>`'s own onSubmit prop type collides with @opentui/react's
    // generic renderable-options typing (resolves to an unsatisfiable
    // intersection), so Enter is handled the same way OverlayList/InputBar
    // handle every other key: a useKeyboard callback gated on 'overlay'
    // owning the layer stack, which only holds while this form is mounted
    // inside an open Overlay.
    //
    // Submitting blank is only meaningful for a provider that already has a
    // key — it clears it, mirroring OpenCode's separate `auth logout`
    // without needing a second command or keybinding here. For an
    // unconfigured provider, a blank submit does nothing.
    useKeyboard(key => {
        if (!layers.isOnTop('overlay')) return;
        if (key.name !== 'return') return;
        key.preventDefault();

        const trimmed = value.trim();
        if (trimmed === '') {
            if (!isConfigured) return;
            removeAuthKey(provider);
            onCleared(provider);
            return;
        }

        writeAuthKey(provider, trimmed);
        onSaved(provider);
    });

    return (
        <box>
            <text attributes={TextAttributes.BOLD}>{PROVIDER_LABELS[provider]}</text>
            <box marginTop={1}>
                <input
                    focused
                    value={value}
                    onInput={setValue}
                    placeholder={isConfigured ? 'New key, or blank + enter to clear' : 'Paste your API key'}
                />
            </box>
        </box>
    );
}

/**
 * `/connect`'s overlay body: a provider list, then (on selection) a key-entry
 * form for that provider — both steps live in one component, owning which is
 * shown via local state, rather than something `useOverlay` needs to know
 * about. Escape always closes the whole overlay from either step, same as
 * every other picker in this app.
 */
export function ConnectFlow() {
    const overlay = useOverlay();
    const toast = useToast();
    const [selected, setSelected] = useState<SupportedProvider | null>(null);
    const [configured, setConfigured] = useState<Set<SupportedProvider>>(
        () => new Set(getConfiguredProviders()),
    );

    if (selected === null) {
        return (
            <OverlayList<SupportedProvider>
                items={[...SUPPORTED_PROVIDERS]}
                getKey={provider => provider}
                filter={prefixFilter(provider => PROVIDER_LABELS[provider])}
                onSelect={provider => setSelected(provider)}
                renderer={provider => (
                    <box flexDirection="row" gap={1} justifyContent="space-between">
                        <text>{PROVIDER_LABELS[provider]}</text>
                        <text attributes={TextAttributes.DIM}>
                            {configured.has(provider) ? '● configured' : 'not set'}
                        </text>
                    </box>
                )}
                emptyMessage="No providers found"
            />
        );
    }

    return (
        <ConnectForm
            provider={selected}
            isConfigured={configured.has(selected)}
            onSaved={provider => {
                setConfigured(current => new Set(current).add(provider));
                toast.info(`${PROVIDER_LABELS[provider]} key saved`);
                overlay.close();
            }}
            onCleared={provider => {
                setConfigured(current => {
                    const next = new Set(current);
                    next.delete(provider);
                    return next;
                });
                toast.info(`${PROVIDER_LABELS[provider]} key cleared`);
                overlay.close();
            }}
        />
    );
}
