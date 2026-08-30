import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import type { ToolCallPart } from '@codeyantram/shared';
import { useTheme } from '../providers/theme';
import { useLayerStack } from '../providers/keyboard';

function formatArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return '(no arguments)';

    return entries.map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n');
}

type ApprovalPromptProps = {
    toolCall: ToolCallPart;
    onDecide: (approved: boolean) => void;
};

export function ApprovalPrompt({ toolCall, onDecide }: ApprovalPromptProps) {
    const { colors } = useTheme();
    const layers = useLayerStack();

    useKeyboard(key => {
        if (!layers.isOnTop('overlay')) return;

        if (key.name === 'y' || key.name === 'return') {
            key.preventDefault();
            onDecide(true);
        } else if (key.name === 'n') {
            key.preventDefault();
            onDecide(false);
        }
    });

    return (
        <box flexDirection="column" gap={1}>
            <text attributes={TextAttributes.BOLD}>{toolCall.toolName}</text>
            <text wrapMode="word" attributes={TextAttributes.DIM}>
                {formatArgs(toolCall.args)}
            </text>
            <box flexDirection="row" gap={2} marginTop={1}>
                <text fg={colors.success}>[y] Approve</text>
                <text fg={colors.error}>[n] Deny</text>
            </box>
        </box>
    );
}
