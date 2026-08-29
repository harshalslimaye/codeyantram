import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';
import { DEFAULT_THEME, themes, type ThemeColors, type Theme } from '../theme';

const CONFIG_DIR = join(homedir(), '.codeyantram');
const THEME_PREFERENCES_PATH = join(CONFIG_DIR, 'preferences.json');

type ThemePreferences = {
    themeName: string;
};

// Bun sets NODE_ENV=test automatically for `bun test`. Nearly every test in
// this suite mounts ThemeProvider, and several call setTheme, so without
// this guard the test run would read and write the real file at
// ~/.codeyantram on whatever machine runs it.
const isTestEnv = process.env.NODE_ENV === 'test';

export function getInitialTheme(): Theme {
    if (isTestEnv) return DEFAULT_THEME;

    try {
        const preferences = JSON.parse(readFileSync(THEME_PREFERENCES_PATH, 'utf-8')) as ThemePreferences;
        const savedTheme = themes.find(theme => theme.name === preferences.themeName);
        return savedTheme ?? DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
}

function persistTheme(theme: Theme): void {
    if (isTestEnv) return;

    try {
        mkdirSync(CONFIG_DIR, { recursive: true });
        const preferences: ThemePreferences = { themeName: theme.name };
        writeFileSync(THEME_PREFERENCES_PATH, JSON.stringify(preferences), 'utf-8');
    } catch (error) {
        console.error('Failed to persist theme preferences:', error);
    }
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
