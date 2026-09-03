import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { NETWORK_TOOLS, type ToolCallPart } from '@codeyantram/shared';
import { useTheme } from '../providers/theme';
import { useLayerStack } from '../providers/keyboard';

function formatArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return '(no arguments)';

    return entries.map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n');
}

// NETWORK_TOOLS is typed against the catalog's own ToolName union; toolName here comes
// off the wire as a plain string (see toolCallPartSchema), so this widens rather than
// narrowing - a tool this build doesn't know about just never matches.
const NETWORK_TOOL_NAMES: readonly string[] = NETWORK_TOOLS;

/** A one-line warning shown above the arguments for any tool that leaves the machine -
 * derived from NETWORK_TOOLS rather than switching on `bash`/`web_fetch` by name, so a
 * future network tool gets this for free. Names the destination host when the call has
 * a `url` argument to read one from; falls back to a generic phrasing otherwise. */
function networkEgressWarning(toolCall: ToolCallPart): string | null {
    if (!NETWORK_TOOL_NAMES.includes(toolCall.toolName)) return null;

    const url = toolCall.args['url'];
    let host: string | null = null;
    if (typeof url === 'string') {
        try {
            host = new URL(url).host;
        } catch {
            host = null;
        }
    }

    return `Sends an HTTPS request to ${host ?? 'a remote host'}. The response is untrusted.`;
}

type ApprovalPromptProps = {
    toolCall: ToolCallPart;
    onDecide: (approved: boolean) => void;
};

export function ApprovalPrompt({ toolCall, onDecide }: ApprovalPromptProps) {
    const { colors } = useTheme();
    const layers = useLayerStack();
    const egressWarning = networkEgressWarning(toolCall);

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
            {egressWarning !== null && (
                <text wrapMode="word" fg={colors.accent}>
                    {egressWarning}
                </text>
            )}
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
