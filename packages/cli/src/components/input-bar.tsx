import { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useRenderer } from '@opentui/react';
import { useTheme } from '../providers/theme';
import { useModel } from '../providers/model';
import { useAgent } from '../providers/agent';
import { useChat } from '../providers/chat';
import { useLayerStack } from '../providers/keyboard';
import { ROOT_LAYER } from '../keyboard';
import { CommandMenu } from './command-menu';

type InputBarProps = {
    placeholder?: string;
    paddingBottom?: number;
};

export function InputBar({ placeholder = "ask anything ... 'fix the socket handshake'", paddingBottom = 0 }: InputBarProps) {
    const { colors } = useTheme();
    const { model } = useModel();
    const { agent } = useAgent();
    const chat = useChat();
    const [value, setValue] = useState('');
    const layers = useLayerStack();
    const renderer = useRenderer();

    // At root: return sends the prompt (ignored while a turn is already
    // streaming - sendMessage itself is single-flight, this just avoids
    // clearing text the send didn't actually consume). Escape cancels an
    // in-flight stream if there is one, otherwise clears the prompt if
    // there's anything to clear. Ctrl+c does the same as escape's clear,
    // but quits once the prompt is already empty instead of doing nothing.
    // While autocomplete (or, later, an overlay) owns the keyboard, this
    // stays silent — that layer's own handler closes it first, and root
    // only sees the key once there's nothing left on top.
    useKeyboard(key => {
        if (!layers.isOnTop(ROOT_LAYER)) return;

        if (key.name === 'return' && !chat.isStreaming) {
            const trimmed = value.trim();
            if (trimmed === '') return;

            key.preventDefault();
            chat.sendMessage(trimmed);
            setValue('');
            return;
        }

        if (key.name === "escape") {
            if (chat.isStreaming) {
                key.preventDefault();
                chat.cancel();
                return;
            }
            if (value !== '') {
                key.preventDefault();
                setValue('');
                return;
            }
        }

        if (!(key.ctrl && key.name === 'c')) return;

        key.preventDefault();
        if (value !== '') {
            setValue('');
        } else {
            renderer.destroy();
        }
    });

    return (
        <box position="relative" width="100%">
            <box backgroundColor={colors.panel} paddingX={2} paddingY={1} width="100%">
                <CommandMenu value={value} onSelect={setValue} />
                <input
                    focused
                    value={value}
                    onInput={setValue}
                    paddingY={1}
                    paddingX={2}
                    placeholder={placeholder}
                />
                <box flexDirection="row" justifyContent="space-between" marginBottom={paddingBottom}>
                    <box flexDirection="row" gap={1}>
                        <text fg={colors.accent}>{agent.name}</text>
                        <text attributes={TextAttributes.DIM}>›</text>
                        <text attributes={TextAttributes.DIM}>{model.id}</text>
                    </box>
                    <box>
                        <text attributes={TextAttributes.DIM}>↵ send</text>
                    </box>
                </box>
            </box>
        </box>
    );
}
