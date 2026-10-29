/** Source ID registered with the Page preview core plugin for hover previews of reference widgets. */
export const HOVER_SOURCE = 'equation-refs';

/** DOM changes made outside CodeMirror that must be undone when the plugin unloads. */
export interface Restorable {
	restore(): void;
}
