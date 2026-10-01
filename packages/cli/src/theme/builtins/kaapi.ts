import type {ThemeDefinition} from '../registry/types.js';

export const kaapiTheme = {
	id: 'kaapi',
	name: 'Kaapi',
	colors: {
		text: '#F2EDE5',
		muted: '#A99D92',
		primary: '#CC785C',
		border: '#332C27',
		prompt: '#E3B778',
		status: '#A99D92',
		success: '#7EA17A',
		warning: '#C96B5C',
		error: '#C84A42',
	},
} satisfies ThemeDefinition;
