import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';
import { DEFAULT_THEME, themes, type ThemeColors, type Theme } from '../theme';
import { readPreferences, writePreferences } from '../utils/preferences';

export function getInitialTheme(): Theme {
    const preferences = readPreferences();
    const savedTheme = themes.find(theme => theme.name === preferences.themeName);
    return savedTheme ?? DEFAULT_THEME;
}

function persistTheme(theme: Theme): void {
    writePreferences({ themeName: theme.name });
}

type ThemeContextValue = {
    colors: ThemeColors;
    currentTheme: Theme;
    setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

type ThemeProviderProps = {
    children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
    const [currentTheme, setCurrentTheme] = useState<Theme>(() => getInitialTheme());

    const setTheme = useCallback((theme: Theme) => {
        setCurrentTheme(theme);
        persistTheme(theme);
    }, []);

    return (
        <ThemeContext.Provider value={{ colors: currentTheme.colors, currentTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}
