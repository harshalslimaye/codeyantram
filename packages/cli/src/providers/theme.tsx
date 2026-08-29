import { createContext, useContext, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, type Theme, type ThemeColors } from '../theme';

type ThemeContextValue = {
    colors: ThemeColors,
    theme: Theme,
    setTheme: (theme: Theme) => void,
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

type ThemeProviderProps = {
    children: ReactNode,
};

export function ThemeProvider({ children }: ThemeProviderProps) {
    const [theme] = useState<Theme>(DEFAULT_THEME);

    return (
        <ThemeContext.Provider value={{ colors: theme.colors, theme, setTheme: () => {} }}>
            {children}
        </ThemeContext.Provider>
    );
}