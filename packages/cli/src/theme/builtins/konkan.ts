import type {ThemeDefinition} from '../registry/types.js';

export const konkanTheme = {
	id: 'konkan',
	name: 'Konkan',
	colors: {
		text: '#EBDBB2',
		muted: '#928374',
		primary: '#83A598',
		border: '#3C3836',
		prompt: '#FABD2F',
		status: '#928374',
		success: '#B8BB26',
		warning: '#FE8019',
		error: '#FB4934',
	},
} satisfies ThemeDefinition;
