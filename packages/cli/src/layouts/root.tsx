import type { ReactNode } from 'react';
import { ThemeProvider } from '../providers/theme';

export function Root({ children }: { children: ReactNode }) {
    return (
        <ThemeProvider>
            {children}
        </ThemeProvider>
    );
}