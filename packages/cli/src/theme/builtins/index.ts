import type {ThemeDefinition} from '../registry/types.js';

import {sahyadriTheme} from './sahyadri.js';
import {kaapiTheme} from './kaapi.js';
import {thiraiTheme} from './thirai.js';
import {konkanTheme} from './konkan.js';
import {sanganakTheme} from './sanganak.js';

export {sahyadriTheme, kaapiTheme, thiraiTheme, konkanTheme, sanganakTheme};

export const BUILTIN_THEMES: ThemeDefinition[] = [
	sahyadriTheme,
	kaapiTheme,
	thiraiTheme,
	konkanTheme,
	sanganakTheme,
];
