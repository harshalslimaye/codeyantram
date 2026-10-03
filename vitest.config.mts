import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	test: {
		environment: 'node',
		clearMocks: true,
		restoreMocks: true,
		unstubEnvs: true,
		projects: ['cli', 'shared', 'core'].map(name => ({
			extends: true,
			test: {
				name,
				include: [`packages/${name}/tests/**/*.test.{ts,tsx}`],
			},
		})),
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['packages/*/src/**/*.{ts,tsx}'],
			exclude: ['**/*.test.{ts,tsx}'],
		},
	},
});
