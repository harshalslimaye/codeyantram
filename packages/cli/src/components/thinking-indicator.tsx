import { useEffect, useState } from 'react';
import { TextAttributes } from '@opentui/core';

const THINKING_FRAMES = ['', '.', '..', '...'];
const THINKING_INTERVAL_MS = 400;

type ThinkingIndicatorProps = {
    animate: boolean;
};

/** Placeholder shown in place of hidden reasoning text - the dots only animate while the reasoning is still being generated, so a completed historical message doesn't keep a timer running forever. */
export function ThinkingIndicator({ animate }: ThinkingIndicatorProps) {
    const [frame, setFrame] = useState(0);

    useEffect(() => {
        if (!animate) return;
        const id = setInterval(() => setFrame(current => (current + 1) % THINKING_FRAMES.length), THINKING_INTERVAL_MS);
        return () => clearInterval(id);
    }, [animate]);

    return (
        <text attributes={TextAttributes.DIM}>Thinking{animate ? THINKING_FRAMES[frame] : '...'}</text>
    );
}
