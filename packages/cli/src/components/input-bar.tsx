import { useRef, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import type { TextareaRenderable } from '@opentui/core';
import { useKeyboard, useRenderer } from '@opentui/react';
import { useTheme } from '../providers/theme';
import { useModel } from '../providers/model';
import { useEffort } from '../providers/effort';
import { useReasoningVisibility } from '../providers/reasoning-visibility';
import { useAgent } from '../providers/agent';
import { getNextAgent } from '../agents';
import { useChat } from '../providers/chat';
import { useLayerStack } from '../providers/keyboard';
import { ROOT_LAYER } from '../keyboard';
import { CommandMenu } from './command-menu';

type InputBarProps = {
    placeholder?: string;
    paddingBottom?: number;
};

// Enter submits, shift+enter inserts a newline - overrides the textarea's
// default binding (plain return -> newline, meta+return -> submit) to match
// the single-line input's prior UX.
const INPUT_MAX_ROWS = 10;

const textareaKeyBindings = [
    { name: 'return', action: 'submit' as const },
    { name: 'return', shift: true, action: 'newline' as const },
    { name: 'kpenter', action: 'submit' as const },
    { name: 'kpenter', shift: true, action: 'newline' as const },
];

export function InputBar({ placeholder = "ask anything ... 'fix the socket handshake'", paddingBottom = 0 }: InputBarProps) {
    const { colors } = useTheme();
    const { model } = useModel();
    const { effort } = useEffort();
    const { showThoughts, toggle: toggleThoughts } = useReasoningVisibility();
    const { agent, setAgent } = useAgent();
    const chat = useChat();
    const [value, setValue] = useState('');
    const layers = useLayerStack();
    const renderer = useRenderer();
    const textareaRef = useRef<TextareaRenderable>(null);

    const clearInput = () => {
        textareaRef.current?.clear();
        setValue('');
    };

    const setInputValue = (next: string) => {
        textareaRef.current?.setText(next);
        setValue(next);
    };

    // Escape cancels an in-flight stream if there is one, otherwise clears
    // the prompt if there's anything to clear. Ctrl+c does the same as
    // escape's clear, but quits once the prompt is already empty instead of
    // doing nothing. Submit (enter) is handled by the textarea itself via
    // onSubmit below. While autocomplete (or, later, an overlay) owns the
    // keyboard, this stays silent - that layer's own handler closes it
    // first, and root only sees the key once there's nothing left on top.
    useKeyboard(key => {
        if (!layers.isOnTop(ROOT_LAYER)) return;

        if (key.name === "escape") {
            if (chat.isStreaming) {
                key.preventDefault();
                chat.cancel();
                return;
            }
            if (value !== '') {
                key.preventDefault();
                clearInput();
                return;
            }
        }

        if (key.name === 'tab') {
            key.preventDefault();
            setAgent(getNextAgent(agent));
            return;
        }

        if (key.ctrl && key.name === 't') {
            key.preventDefault();
            toggleThoughts();
            return;
        }

        if (!(key.ctrl && key.name === 'c')) return;

        key.preventDefault();
        if (value !== '') {
            clearInput();
        } else {
            renderer.destroy();
        }
    });

    const handleSubmit = () => {
        if (chat.isStreaming) return;
        const trimmed = value.trim();
        if (trimmed === '') return;

        chat.sendMessage(trimmed);
        clearInput();
    };

    return (
        <box border={['left']} borderColor={colors.accent} position="relative" width="100%">
            <box backgroundColor={colors.panel} paddingX={2} paddingY={1} width="100%">
                <CommandMenu value={value} onSelect={setInputValue} />
                <textarea
                    ref={textareaRef}
                    focused
                    onContentChange={() => setValue(textareaRef.current?.plainText ?? '')}
                    onSubmit={handleSubmit}
                    keyBindings={textareaKeyBindings}
                    paddingY={1}
                    paddingX={2}
                    maxHeight={INPUT_MAX_ROWS}
                    placeholder={placeholder}
                />
                <box flexDirection="row" justifyContent="space-between">
                    <box flexDirection="row" gap={1}>
                        <text fg={colors.accent}>{agent.name}</text>
                        <text attributes={TextAttributes.DIM}>›</text>
                        <text>{model.id}</text>
                        {effort !== undefined && (
                            <>
                                <text attributes={TextAttributes.DIM}>·</text>
                                <text attributes={TextAttributes.DIM}>{effort}</text>
                            </>
                        )}
                    </box>
                    <box>
                        <text attributes={TextAttributes.DIM}>↵ send</text>
                    </box>
                </box>
            </box>
        </box>
    );
}
