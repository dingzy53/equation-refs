import { Plugin, TFile } from 'obsidian';
import { HOVER_SOURCE, Restorable } from './constants';
import { formatReference } from './core/format';
import { EquationLabel } from './core/numbering';
import { EquationNumbers } from './index/equation-numbers';
import { equationNumbersInEditor } from './render/live-preview/equation-numbers';
import { referenceLinksInEditor } from './render/live-preview/reference-links';
import { createReadingViewProcessor } from './render/reading-view';
import { DEFAULT_SETTINGS, EquationRefsSettings, EquationRefsSettingTab, readSettings } from './settings';

export default class EquationRefsPlugin extends Plugin {
	settings: EquationRefsSettings = { ...DEFAULT_SETTINGS };
	numbers!: EquationNumbers;
	readonly rendered = new Set<Restorable>();

	async onload(): Promise<void> {
		this.settings = readSettings(await this.loadData());
		this.numbers = this.addChild(new EquationNumbers(this.app));

		this.addSettingTab(new EquationRefsSettingTab(this.app, this));
		this.registerHoverLinkSource(HOVER_SOURCE, { display: this.manifest.name, defaultMod: true });
		this.registerMarkdownPostProcessor(createReadingViewProcessor(this));
		this.registerEditorExtension([equationNumbersInEditor(this), referenceLinksInEditor(this)]);
	}

	onunload(): void {
		for (const item of this.rendered) item.restore();
		this.rendered.clear();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.numbers.refreshAll();
	}

	/** The text shown for a link from `sourcePath` to an equation in `target`. */
	referenceText(sourcePath: string, target: TFile, label: EquationLabel): string {
		const template = sourcePath === target.path ? this.settings.sameNoteFormat : this.settings.otherNoteFormat;
		return formatReference(template, { n: label.text, note: target.basename });
	}
}
