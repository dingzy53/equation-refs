import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'test-vault',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// The recommended config never lints manifest.json itself, so the review's manifest checks
		// (description format, forbidden words, required keys) would otherwise go unchecked locally.
		files: ['manifest.json'],
		languageOptions: { parser: tseslint.parser },
		extends: [tseslint.configs.disableTypeChecked],
		rules: { 'obsidianmd/validate-manifest': 'error' },
	},
);
