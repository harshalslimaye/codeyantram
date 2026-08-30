import { useTerminalDimensions } from '@opentui/react';
import { useTheme } from '../providers/theme';

export type ToastVariant = 'info' | 'warn' | 'error';

export type ToastData = {
    id: string;
    variant: ToastVariant;
    message: string;
};

const TOAST_WIDTH = 40;

function Toast({ variant, message }: { variant: ToastVariant; message: string }) {
    const { colors } = useTheme();
    const color = { info: colors.accent, warn: colors.focus, error: colors.error }[variant];

    return (
        <box border={['left']} borderColor={color}>
            <box backgroundColor={colors.panel} padding={1} width={TOAST_WIDTH}>
                <text fg={color} wrapMode="word">{message}</text>
            </box>
        </box>
    );
}

/**
 * Full-screen absolute stack, top-right aligned, sitting above `Overlay`
 * (zIndex 100) so a toast stays visible while an overlay is open. Unlike
 * `Overlay`, this never claims the keyboard layer and never touches focus —
 * toasts are non-interactive and self-dismissing, so they must not steal
 * escape/ctrl+c from whatever is underneath.
 */
export function ToastStack({ toasts }: { toasts: ToastData[] }) {
    const dimensions = useTerminalDimensions();

    if (toasts.length === 0) return null;

    return (
        <box
            position="absolute"
            top={0}
            left={0}
            width={dimensions.width}
            height={dimensions.height}
            zIndex={200}
            alignItems="flex-end"
            justifyContent="flex-start"
            paddingTop={1}
            paddingRight={2}
        >
            <box flexDirection="column" gap={1}>
                {toasts.map(toast => (
                    <Toast key={toast.id} variant={toast.variant} message={toast.message} />
                ))}
            </box>
        </box>
    );
}
