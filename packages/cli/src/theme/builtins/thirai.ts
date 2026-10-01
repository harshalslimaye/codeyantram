import type {ThemeDefinition} from '../registry/types.js';

export const thiraiTheme = {
	id: 'thirai',
	name: 'Thirai',
	colors: {
		text: '#D8DEE9',
		muted: '#81A1C1',
		primary: '#88C0D0',
		border: '#434C5E',
		prompt: '#EBCB8B',
		status: '#81A1C1',
		success: '#A3BE8C',
		warning: '#D08770',
		error: '#BF616A',
	},
} satisfies ThemeDefinition;
