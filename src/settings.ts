import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import { validateTemplate } from './core/format';
import type EquationRefsPlugin from './main';

export interface EquationRefsSettings {
	sameNoteFormat: string;
	otherNoteFormat: string;
}

export const DEFAULT_SETTINGS: EquationRefsSettings = {
	sameNoteFormat: '({n})',
	otherNoteFormat: '{note} ({n})',
};

/** Merge saved data over the defaults, dropping anything malformed. */
export function readSettings(data: unknown): EquationRefsSettings {
	const settings = { ...DEFAULT_SETTINGS };
	if (typeof data !== 'object' || data === null) return settings;
	const saved = data as Partial<Record<keyof EquationRefsSettings, unknown>>;
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof EquationRefsSettings)[]) {
		const value = saved[key];
		if (typeof value === 'string' && !validateTemplate(value)) settings[key] = value;
	}
	return settings;
}

export class EquationRefsSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly owner: EquationRefsPlugin) {
		super(app, owner);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Same-note reference format',
				desc: 'How a link to an equation in the same note is shown. {n} is the equation number.',
				control: {
					type: 'text',
					key: 'sameNoteFormat',
					defaultValue: DEFAULT_SETTINGS.sameNoteFormat,
					placeholder: DEFAULT_SETTINGS.sameNoteFormat,
					validate: validateTemplate,
				},
			},
			{
				name: 'Other-note reference format',
				desc: 'How a link to an equation in another note is shown. {n} is the equation number and {note} is the note name.',
				control: {
					type: 'text',
					key: 'otherNoteFormat',
					defaultValue: DEFAULT_SETTINGS.otherNoteFormat,
					placeholder: DEFAULT_SETTINGS.otherNoteFormat,
					validate: validateTemplate,
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.owner.settings[key as keyof EquationRefsSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!(key in DEFAULT_SETTINGS) || typeof value !== 'string') return;
		this.owner.settings[key as keyof EquationRefsSettings] = value;
		await this.owner.saveSettings();
	}
}
