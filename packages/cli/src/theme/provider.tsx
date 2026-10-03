import React, {createContext, useContext, useMemo, type ReactNode} from 'react';
import {defaultTheme, extendTheme, ThemeProvider as InkUIThemeProvider} from '@inkjs/ui';
import {detectTerminalColorDepth, resolveThemeColor} from './utils/colors.js';
import {saveThemePreference} from './utils/index.js';
import type {ThemeRegistry} from './registry/registry.js';
import {THEME_ROLES, type ThemeRole} from './registry/types.js';

export type InkThemePalette = Record<ThemeRole, string | undefined>;
export type ThemeNoticeTone = 'success' | 'error';

export interface ThemeContextValue {
	palette: InkThemePalette;
	themes: ReturnType<ThemeRegistry['list']>;
	selectedId: string;
	notice?: string;
	noticeTone: ThemeNoticeTone;
	selectTheme: (id: string) => Promise<void>;
	setNotice: (notice?: string, tone?: ThemeNoticeTone) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({
	registry,
	initialThemeId,
	children,
	colorDepth = detectTerminalColorDepth(),
	mode = 'dark',
}: {
	registry: ThemeRegistry;
	initialThemeId: string;
	children: ReactNode;
	colorDepth?: number;
	mode?: 'dark' | 'light';
}) {
	const [selectedId, setSelectedId] = React.useState(initialThemeId);
	const [notice, setNotice] = React.useState<string>();
	const [noticeTone, setNoticeTone] = React.useState<ThemeNoticeTone>('success');
	const selected = registry.get(selectedId) ?? registry.resolve(undefined).selected;
	const palette = useMemo(() => Object.fromEntries(
		THEME_ROLES.map(role => [role, resolveThemeColor(selected.theme, role, colorDepth, mode)]),
	) as InkThemePalette, [selected.theme, colorDepth, mode]);
	const themes = useMemo(() => registry.list(), [registry]);
	const uiTheme = useMemo(() => extendTheme(defaultTheme, {
		components: {
			Select: {
				styles: {
					focusIndicator: () => ({color: palette.prompt}),
					selectedIndicator: () => ({color: palette.success}),
					label: ({isFocused}: {isFocused: boolean}) => ({color: isFocused ? palette.prompt : palette.text}),
				},
			},
			TextInput: {
				styles: {
					value: () => ({color: palette.text}),
				},
			},
			PasswordInput: {
				styles: {
					value: () => ({color: palette.text}),
				},
			},
			Spinner: {
				styles: {
					frame: () => ({color: palette.prompt}),
					label: () => ({color: palette.muted}),
				},
			},
			StatusMessage: {
				styles: {
					icon: ({variant}: {variant: 'success' | 'error' | 'warning' | 'info'}) => ({color: palette[variant === 'info' ? 'primary' : variant]}),
					message: () => ({color: palette.text}),
				},
			},
		},
	}), [palette]);

	const selectTheme = async (id: string) => {
		const entry = registry.get(id);
		if (!entry) throw new Error(`Theme "${id}" is not available.`);
		await saveThemePreference(id);
		setSelectedId(id);
		setNotice(`Using ${entry.theme.name}; saved to user config.`);
		setNoticeTone('success');
	};

	const updateNotice = (message?: string, tone: ThemeNoticeTone = 'success') => {
		setNotice(message);
		setNoticeTone(tone);
	};

	return (
		<ThemeContext.Provider value={{palette, themes, selectedId, notice, noticeTone, selectTheme, setNotice: updateNotice}}>
			<InkUIThemeProvider theme={uiTheme}>{children}</InkUIThemeProvider>
		</ThemeContext.Provider>
	);
}

export function useTheme(): ThemeContextValue {
	const theme = useContext(ThemeContext);
	if (!theme) throw new Error('useTheme must be used inside ThemeProvider.');
	return theme;
}
