import { useTheme } from '../providers/theme';
import { TextAttributes } from '@opentui/core';
import { InputBar } from '../components/input-bar';

export function Home() {
    const { colors } = useTheme();

    return (
        <box backgroundColor={colors.bg} alignItems="center" justifyContent="center" flexGrow={1}>
            <box width={60} alignItems="center" gap={1}>
                <box flexDirection="row" gap={1} marginBottom={1}>
                    <ascii-font color={colors.text} font="tiny" text="Code" />
                    <ascii-font color={colors.accent} font="tiny" text="Yantram" />
                </box>
                <InputBar />
            </box>
            <box flexDirection="row" width={60} justifyContent="space-between" marginTop={1}>
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