import type {ThemeDefinition} from '../registry/types.js';

export const sahyadriTheme = {
	id: 'sahyadri',
	name: 'Sahyadri',
	colors: {
		text: '#EDE6D6',
		muted: '#B58656',
		primary: '#6C7CE8',
		border: '#292F68',
		prompt: '#D9A24B',
		status: '#B58656',
		success: '#5C9464',
		warning: '#C0654A',
		error: '#BB5648',
	},
} satisfies ThemeDefinition;
