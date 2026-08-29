import { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '../providers/theme';
import { CommandMenu } from './command-menu';

type InputBarProps = {
    placeholder?: string;
};

export function InputBar({ placeholder = "ask anything ... 'fix the socket handshake'" }: InputBarProps) {
    const { colors } = useTheme();
    const [value, setValue] = useState('');

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
