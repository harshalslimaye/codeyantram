import { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useRenderer } from '@opentui/react';
import { useTheme } from '../providers/theme';
import { useLayerStack } from '../providers/keyboard';
import { ROOT_LAYER } from '../keyboard';
import { CommandMenu } from './command-menu';

type InputBarProps = {
    placeholder?: string;
};

export function InputBar({ placeholder = "ask anything ... 'fix the socket handshake'" }: InputBarProps) {
    const { colors } = useTheme();
    const [value, setValue] = useState('');
    const layers = useLayerStack();
    const renderer = useRenderer();

    // At root: escape clears the prompt if there's anything to clear; ctrl+c
    // does the same, but quits once the prompt is already empty instead of
    // doing nothing. While autocomplete (or, later, an overlay) owns the
    // keyboard, this stays silent — that layer's own handler closes it
    // first, and root only sees the key once there's nothing left on top.
    useKeyboard(key => {
        if (!layers.isOnTop(ROOT_LAYER)) return;

        if (key.name === "escape" && value !== '') {
            key.preventDefault();
            setValue('');
            return;
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
                <box flexDirection="row" justifyContent="space-between">
                    <box flexDirection="row" gap={1}>
                        <text fg={colors.accent}>plan</text>
                        <text attributes={TextAttributes.DIM}>›</text>
                        <text attributes={TextAttributes.DIM}>claude-sonnet-5</text>
                    </box>
                    <box>
                        <text attributes={TextAttributes.DIM}>↵ send</text>
                    </box>
                </box>
            </box>
        </box>
    );
}
