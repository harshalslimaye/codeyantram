import { useTheme } from '../providers/theme';
import { TextAttributes } from '@opentui/core';

export function Home() {
    const { colors, theme } = useTheme();

    return (
        <box backgroundColor={colors.bg} alignItems="center" justifyContent="center" flexGrow={1}>
            <box width={60} alignItems="center" gap={1}>
                <box flexDirection="row" gap={1} marginBottom={1}>
                    <ascii-font font="tiny" text="Code" />
                    <ascii-font color={colors.accent} font="tiny" text="Yantram" />
                </box>
                <box backgroundColor={colors.panel} paddingX={2} paddingY={1} width="100%">
                    <input paddingY={1} paddingX={2} placeholder="ask anything ... 'fix the socket handshake'" />
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
            <box flexDirection="row" width={60} justifyContent='space-between' marginTop={1}>
                <box flexDirection="row" gap={2}>
                    <box flexDirection="row" gap={1}>
                        <text>tab</text>
                        <text attributes={TextAttributes.DIM}>agent</text>
                    </box>
                    <box flexDirection="row" gap={1}>
                        <text>ctrl+c</text>
                        <text attributes={TextAttributes.DIM}>exit</text>
                    </box>
                </box>
                <box>
                    <text attributes={TextAttributes.DIM}>v1.0.0</text>
                </box>
            </box>
        </box>
    )
}