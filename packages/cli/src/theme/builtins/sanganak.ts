import type {ThemeDefinition} from '../registry/types.js';

export const sanganakTheme = {
	id: 'sanganak',
	name: 'Sanganak',
	colors: {
		text: '#D4D4D4',
		muted: '#777777',
		primary: '#7CFC00',
		border: '#1C1C1C',
		prompt: '#E5E5E5',
		status: '#777777',
		success: '#7CFC00',
		warning: '#D16969',
		error: '#F44747',
	},
} satisfies ThemeDefinition;
