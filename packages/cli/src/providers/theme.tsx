import { createContext, useState, useContext, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { SyntaxStyle } from '@opentui/core';
import { DEFAULT_THEME, themes, type ThemeColors, type Theme } from '../theme';
import { buildSyntaxStyles } from '../syntax-theme';
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
    syntaxStyle: SyntaxStyle;
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

    // SyntaxStyle wraps a native handle - it isn't garbage-collected, so a new
    // one built on theme switch must destroy() the one it replaces. The effect
    // cleanup runs right before the *next* effect commits, so there's never a
    // gap where `syntaxStyle` points at an already-destroyed handle.
    const syntaxStyle = useMemo(
        () => SyntaxStyle.fromStyles(buildSyntaxStyles(currentTheme.colors)),
        [currentTheme.name],
    );

    useEffect(() => {
        return () => syntaxStyle.destroy();
    }, [syntaxStyle]);

    return (
        <ThemeContext.Provider value={{ colors: currentTheme.colors, currentTheme, setTheme, syntaxStyle }}>
            {children}
        </ThemeContext.Provider>
    );
}
