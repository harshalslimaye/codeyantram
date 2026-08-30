import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastStack, type ToastData, type ToastVariant } from '../components/toast';

type ToastOptions = {
    duration?: number;
};

export type ToastContextValue = {
    info(message: string, options?: ToastOptions): string;
    warn(message: string, options?: ToastOptions): string;
    error(message: string, options?: ToastOptions): string;
    /** Dismisses the toast with this id, if it's still showing. */
    dismiss(id: string): void;
};

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
    info: 3000,
    warn: 4000,
    error: 6000,
};

// Toasts are meant to be glanceable, not a backlog — once a fourth arrives
// the oldest is dropped rather than growing the stack indefinitely.
const MAX_VISIBLE = 3;

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastData[]>([]);
    const nextId = useRef(0);
    // Timers live in a ref, keyed by id, rather than being derived from
    // `toasts` state — that lets `dismiss` (called either by its own timeout
    // or directly by a caller) always cancel the right timer without
    // rendering anything itself.
    const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    // Guards against a stray timer firing setState after the provider (and
    // everything below it) has unmounted.
    useEffect(() => {
        const timers = timersRef.current;
        return () => {
            timers.forEach(timer => clearTimeout(timer));
            timers.clear();
        };
    }, []);

    // Stable identity, like OverlayProvider's `value`, so a command's action
    // callback can hold onto it without needing this in a dependency array.
    const value = useMemo<ToastContextValue>(() => {
        const clearTimer = (id: string) => {
            const timer = timersRef.current.get(id);
            if (timer === undefined) return;
            clearTimeout(timer);
            timersRef.current.delete(id);
        };

        const dismiss = (id: string) => {
            clearTimer(id);
            setToasts(current => current.filter(toast => toast.id !== id));
        };

        const show = (variant: ToastVariant, message: string, options?: ToastOptions): string => {
            const id = String(nextId.current++);
            const duration = options?.duration ?? DEFAULT_DURATIONS[variant];

            setToasts(current => {
                const next = [...current, { id, variant, message }];
                const overflow = next.length - MAX_VISIBLE;
                if (overflow <= 0) return next;

                for (const dropped of next.slice(0, overflow)) {
                    clearTimer(dropped.id);
                }
                return next.slice(overflow);
            });

            timersRef.current.set(id, setTimeout(() => dismiss(id), duration));
            return id;
        };

        return {
            info: (message, options) => show('info', message, options),
            warn: (message, options) => show('warn', message, options),
            error: (message, options) => show('error', message, options),
            dismiss,
        };
    }, []);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastStack toasts={toasts} />
        </ToastContext.Provider>
    );
}
