import { useTheme } from '../providers/theme';
import { TextAttributes } from '@opentui/core';
import { InputBar } from '../components/input-bar';
import { getCurrentBranch } from '../utils/git';
import { getRootFolderName } from '@codeyantram/shared';

export function Home() {
    const { colors } = useTheme();
    const branch = getCurrentBranch();
    const rootFolderName = getRootFolderName();

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
                <box flexDirection="row" gap={1}>
                    <box><text>{rootFolderName}</text></box>
                    <box><text attributes={TextAttributes.DIM}>git:{branch}</text></box>                    
                </box>
                <box>
                    <text attributes={TextAttributes.DIM}>v1.0.0</text>
                </box>
            </box>
        </box>
    )
}