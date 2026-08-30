import { useEffect, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '../providers/theme';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

type SpinnerProps = {
    label?: string;
};

export function Spinner({ label = 'Thinking…' }: SpinnerProps) {
    const { colors } = useTheme();
    const [frame, setFrame] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setFrame(current => (current + 1) % FRAMES.length), INTERVAL_MS);
        return () => clearInterval(id);
    }, []);

    return (
        <box flexDirection="row" gap={1}>
            <text fg={colors.accent}>{FRAMES[frame]}</text>
            <text attributes={TextAttributes.DIM}>{label}</text>
        </box>
    );
}
