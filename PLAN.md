# Equation Refs: plan

## 1. Context

*LaTeX-like Theorem & Equation Referencer* (cloned at `/home/ding/GitHub/Obsidian/obsidian-latex-theorem-equation-referencer`) has not been updated since December 2023. It is about 8,200 lines of TypeScript and has 50 open issues. Its main problems:

- **It patches Obsidian's private code**, so it breaks when Obsidian updates (#257, #260).
- **It is slow**: it calls `renderMath` again on every scroll and parses the whole syntax tree on every edit (#256, #252, #150).
- **It needs other plugins** (MathLinks, Quick Preview), and load order matters (#233, #258).
- **Equation numbers attach to the wrong equation** after edits (#225, #238).

Of all its features, the only one wanted is this: number display equations only when something links to them, show `[[note#^label]]` links to them as the number, and keep the numbers in PDF export.

**Outcome:** a small, robust plugin built from scratch that uses only Obsidian's public API. It has **zero runtime dependencies** and can pass the community-directory automated review.

### Can it be done without outside dependencies? Yes.

- **Runtime:** nothing is bundled except our own code. `obsidian` and `@codemirror/*` are provided by Obsidian at runtime and are marked `external` in esbuild.
- **MathLinks is not needed.** We draw references ourselves: a post-processor in Reading view, a CodeMirror widget in Live Preview.
- **Development only:** `typescript`, `esbuild`, `eslint`, `eslint-plugin-obsidianmd`, `vitest`, and the types for `obsidian` and `@codemirror/*`.

## 2. Decisions

| Topic | Decision |
|---|---|
| Name / id | **Equation Refs** / `equation-refs`. Free in the directory on 2026-10-29 and doesn't contain "obsidian". |
| Reference format | Link within the same note → `(3)`. Link from another note → `Maxwell (3)`. Both are templates you can change in settings. |
| Where it works | Reading view, Live Preview, PDF export, and embeds. Hover preview is best-effort. |
| Settings | Two text templates, built with the declarative settings API added in 1.13 → `minAppVersion: "1.13.0"`. |
| How numbers are drawn | A CSS `::after` that reads a `data-eq-number` attribute. MathJax never re-renders (see §5). |
| License | **MIT**, the same as the original. Copyright holder is you. The README credits the original. |
| Similar plugins | Equation Citator, Latex Equation References, Auto Equation Numbering, and Equation Ordinal all exist. They use `\label`/`\ref` or edit your files. Ours uses only Obsidian's native block links, numbers only equations that are linked to, and never edits files. The README says this. |

## 3. Behaviour

### Syntax (all standard Obsidian, nothing new to learn)

```md
$$
\nabla \cdot E = \rho / \varepsilon_0
$$
^gauss

As shown in [[#^gauss]] ...            ← same note: shows "(1)"
See [[Maxwell#^gauss]].                ← other note: shows "Maxwell (1)"
See [[Maxwell#^gauss|Gauss's law]].    ← has an alias: left unchanged
```

Obsidian's own `[[note#^` autocomplete already lists math blocks and creates the `^id` for you, so we don't need a suggester.

### Numbering rules (in `src/core/numbering.ts`, unit-tested)

1. **Candidates:** top-level display-math sections in Obsidian's metadata cache (`cache.sections`, `type === 'math'`) that have a block id (`section.id`).
2. **Referenced:** at least one link in the vault (`cache.links` or `cache.frontmatterLinks`, from any note including the same one) points to `thatNote#^id`. Embeds (`![[…]]`) are not counted, because a transclusion is not a reference.
3. **Exceptions:**
   - If the equation contains `\notag` or `\nonumber`, it gets no number.
   - If it contains `\tag{x}`, references show `(x)`, it doesn't use up a counter value, and we add no CSS number because MathJax already draws the tag.
4. **Numbering:** the remaining equations get 1, 2, 3, … in document order, and the count restarts in each note.
5. When a link is added or removed anywhere, the target note's numbers are recomputed and every open view updates in place, usually within about a second.

### Display

- **Equation:** `(3)`, right-aligned, vertically centred, in the body text font. Themes can restyle it through `--eqref-number-*` CSS variables.
- **Reference:** the text of an unaliased link is replaced with the formatted text. It stays a normal internal link: click opens it, and Ctrl/Cmd-hover shows a preview.
- **Live Preview:** putting the cursor in a link shows the raw `[[…]]` again, the same way MathLinks behaves.
- **Missing numbers:** if a target has no number (not found, not top-level, or not yet indexed), the link is left untouched.

## 4. Architecture (about 800 lines plus tests)

```
src/
  main.ts                         Plugin lifecycle only (about 60 lines)
  constants.ts                    Hover source ID, Restorable interface
  settings.ts                     Settings type, defaults, declarative settings tab (about 50)
  core/                           Pure code, no imports from 'obsidian'; unit-tested
    numbering.ts                  numberEquations(blocks, isReferenced) → Map<id, label>
    math-source.ts                findTag/notag; blockIdAfterMath(getLine, lineNo, lineCount)
    links.ts                      parseBlockLink(linktext) → {path, id} | null; LINK_RE for Live Preview
    format.ts                     formatRef(template, {n, note}); template validation
  index/
    reference-index.ts            Reverse link index: target path → (id → link count)
    equation-numbers.ts           Per-note number maps, kept in sync; emits 'changed'
  render/
    dom.ts                        setEquationNumber(): the one place that writes data-eq-number
    reading-view.ts               Post-processor: equation numbers, references, PDF, embeds
    live-preview/
      equation-numbers.ts         ViewPlugin: sets data-eq-number on math widgets
      reference-links.ts          ViewPlugin: replaces [[…#^id]] with a widget showing the number
styles.css
test/                             vitest tests for src/core/*
test-vault/                       Example notes for manual and PDF testing (its .obsidian/ is gitignored)
```

### Data flow

```
metadataCache 'changed' / vault 'delete' 'rename' 'create'
        │
        ▼
ReferenceIndex  (which ids in each note are linked to)
        │  affected target paths
        ▼
EquationNumbers (recomputes those notes; reads text with cachedRead or the 'changed' data)
        │  emits 'changed'(path) only if the numbers actually changed
        ▼
Reading-view render children  ·  Live Preview ViewPlugins  →  update the DOM in place
```

### Module details

**`index/reference-index.ts`**
- Keeps `out: Map<sourcePath, Set<"target\0id">>` and `count: Map<target, Map<id, number>>`.
- `updateSource(file)` parses the note's `links` and `frontmatterLinks`:
  1. Split each link with `parseLinktext`.
  2. Keep only subpaths that start with `#^`.
  3. Resolve the target with `metadataCache.getFirstLinkpathDest(path, source)`. An empty path means the same note.
  4. Diff against the previous set, update the counts, and return the target paths that changed.
- Full `rebuild()` runs over `vault.getMarkdownFiles()`: once after `onLayoutReady` plus the first metadataCache `'resolved'`, and debounced on vault `rename`, `delete` and `create`. Those are rare, and a rebuild only goes through cached metadata, so it's cheap.
- Each metadataCache `'changed'` event updates only that one note.

**`index/equation-numbers.ts`** (extends `Events`)
- Keeps `Map<path, Map<id, label>>`. Only notes that have at least one linked equation are stored.
- `recompute(file, data?)` builds `{id, text}` for each math section, using the section's offsets into the note text, and calls `numberEquations`. It saves the result, compares it with the previous one, and triggers `'changed'` only if something differs.
- Everything is computed ahead of time, so every render path can read numbers **synchronously**. This matters for PDF export.

**`render/reading-view.ts`**: one `registerMarkdownPostProcessor`.

*Equations:* for each `mjx-container.MathJax[display="true"]` whose `.math-block` is top level, work out which note and id it belongs to:
1. **Embed:** if it's inside `.internal-embed[src]`, read the `src` link and get the note and `#^id` from it.
2. **Normal:** `ctx.getSectionInfo(el)` gives the section's source text. Read the `^id` from the math block's last line.
3. **PDF export** (`el.parentElement` has class `print`) or no section info: match by order. The n-th top-level math block in `el` corresponds to the n-th math section in the cache.

Then attach an `EquationNumberChild extends MarkdownRenderChild`. It sets or removes `data-eq-number` and the `eqref-numbered` class, and updates on `numbers.on('changed')` for that note.

*References:* for each `a.internal-link[data-href*="#^"]`:
- Resolve the target note and id.
- Treat the link as unaliased if its text equals `data-href` or contains `^id`.
- Attach a `RefLinkChild` that sets the text and stores the original text in `data-eqref-original` so it can be restored.
- It re-renders when that target's numbers or the format setting change.

**`render/live-preview/equation-numbers.ts`**: a ViewPlugin.
- On `docChanged`, `viewportChanged`, `geometryChanged` or a refresh effect, it calls `view.requestMeasure`:
  - **read:** collect `contentDOM` → `:scope > .cm-embed-block.math mjx-container[display="true"]`, plus `view.posAtDOM(el)`, inside try/catch.
  - **write:** get the id with `blockIdAfterMath` from the live document, look up the number, and set the attribute only if it changed.
- It never calls `renderMath` or `finishRenderMath`. This is the cause of the original's slowness, and we avoid it completely.

**`render/live-preview/reference-links.ts`**: a ViewPlugin with a `DecorationSet`.
- **Active only** when `state.field(editorLivePreviewField)` is true.
- **Matching:** run `LINK_RE` (unaliased `[[path#^id]]`, no lookbehind) over `view.visibleRanges`.
- **Skipped:**
  - links preceded by `!` (embeds)
  - links that a selection range touches
  - links inside code, math or comments, checked with `syntaxTree(state).resolveInner(pos, 1).name`
- **Replacement:** `Decoration.replace({widget: new RefWidget(text, linktext, sourcePath)})`.
- **Widget DOM:** `createSpan({cls: 'cm-hmd-internal-link'})` containing an `a.internal-link`.
  - `mousedown` → `workspace.openLinkText(linktext, sourcePath, Keymap.isModEvent(evt))`.
  - `mouseover` → `workspace.trigger('hover-link', …)`, with `registerHoverLinkSource('equation-refs', …)` registered in `main.ts`.
- **Rebuilt on** `docChanged`, `viewportChanged`, `selectionSet`, a change of the Live Preview field, or the refresh effect.
- **Refresh effect:** each ViewPlugin subscribes to `numbers.on('changed')` and to settings changes in its constructor, calls `view.dispatch({effects: refresh.of(null)})`, and calls `offref` in `destroy()`. No `editor.cm` or other private API.
- **Current note path:** `state.field(editorInfoField).file?.path`.

**`main.ts`**
- `loadSettings`, `addSettingTab`.
- Build `ReferenceIndex` and `EquationNumbers`.
- `registerMarkdownPostProcessor`, `registerEditorExtension([eqNumbersPlugin, refLinksPlugin])`, `registerHoverLinkSource`.
- All events go through `this.registerEvent`.
- `onunload`: call `previewMode.rerender(true)` on open Markdown views so Reading-view text goes back to normal. Never detach leaves.

**`settings.ts`**
- `{ sameNoteFormat: '({n})', otherNoteFormat: '{note} ({n})' }`.
- `PluginSettingTab.getSettingDefinitions()` defines two `text` controls with a `validate` that requires `{n}`. No `display()`.
- Labels are in sentence case: "Same-note reference format", "Other-note reference format".
- On change, emit a refresh.

**`styles.css`**

```css
.markdown-rendered mjx-container.MathJax[display="true"].eqref-numbered,
.cm-embed-block.math mjx-container.MathJax[display="true"].eqref-numbered {
  position: relative; padding-inline: var(--eqref-number-gutter, 3em);
}
mjx-container.MathJax.eqref-numbered::after {
  content: attr(data-eq-number);
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  font-family: var(--eqref-number-font, var(--font-text)); color: var(--text-normal);
}
```

The gutter padding is the same on both sides so the equation stays centred and the number can't overlap it. Print and PDF use the same rule.

## 5. Why CSS numbers instead of injecting `\tag{}`

- **No MathJax re-render**, so it's cheap enough to run on every update. This is what made the original laggy.
- **The same DOM approach works everywhere:** Reading view, Live Preview, embeds and PDF. The browser prints `::after` content.
- **Copying the equation doesn't copy the number**, and there's no "which equation did this tag replace" mix-up (#225).
- **Cost:** no separate numbers for each line of an `align`; the whole `$$` block gets one number. Users who need per-line numbers can write `\tag` by hand, which we respect.

## 6. Edge cases

| Case | Behaviour |
|---|---|
| `$$` inside a callout, list or blockquote | Not numbered, because Obsidian doesn't create a math section for it. Documented. |
| `$$…$$ ^id` on one line | Supported: the `id` comes from `SectionCache`, and `blockIdAfterMath` checks the same line. |
| Label linked only from its own note | Counts as referenced. |
| Target note renamed | Obsidian updates the links, which fires `'changed'`, and there is also a debounced rebuild. |
| Link to an unlabelled or unknown block | Left untouched. |
| Link inside a code block or inline code | Left untouched: Reading view doesn't render it as a link, and Live Preview checks the syntax tree. |
| Canvas | Not supported in v1. Links inside canvases aren't counted. |
| Very large vault | Startup reads only cached metadata. Note text is read only for notes that have linked equations. |

## 7. Repository setup (follows the 2026 `obsidianmd/obsidian-sample-plugin` layout)

```
equation-refs/
  PLAN.md  README.md  LICENSE  manifest.json  versions.json
  package.json  package-lock.json  tsconfig.json  esbuild.config.mjs
  eslint.config.mts  version-bump.mjs  .gitignore  .npmrc  .editorconfig  styles.css
  .github/workflows/lint.yml      build + lint + test on every push and pull request (Node 22/24; vitest 5 needs Node ≥ 22.12)
  .github/workflows/release.yml   on a tag push: npm ci, build, attest provenance, publish a release with main.js, manifest.json, styles.css
  src/…  test/…  test-vault/…
```

- **`manifest.json`**

  ```json
  {
    "id": "equation-refs",
    "name": "Equation Refs",
    "version": "1.0.0",
    "minAppVersion": "1.13.0",
    "description": "Number display equations only when they are linked, and show those links as equation numbers in reading view, live preview, and PDF export.",
    "author": "<your name>",
    "authorUrl": "https://github.com/<your-handle>",
    "isDesktopOnly": false
  }
  ```

  - The description starts with an action, ends with a period, is under 250 characters and has no emoji.
  - There's no `fundingUrl`; add one only if you accept donations.
  - **To fill in:** your name and GitHub handle.
- **`versions.json`**: `{ "1.0.0": "1.13.0" }`.
- **`package.json`**
  - `"license": "MIT"`, no `dependencies`.
  - `devDependencies`: `obsidian@1.14.4` pinned, `@codemirror/state@6.7.6` and `@codemirror/view@6.43.13` pinned to the exact versions `obsidian` declares as peers, `@codemirror/language` for types only, `typescript@^5.9`, `esbuild@^0.28` (the range vitest's vite accepts), `eslint@^9`, `@eslint/js`, `typescript-eslint@^8`, `eslint-plugin-obsidianmd@^0.4.2`, `globals`, `jiti`, `vitest`.
  - Scripts: `dev`, `build` (`tsc -noEmit && node esbuild.config.mjs production`), `lint` (`eslint .`), `test` (`vitest run`), `version`.
  - TypeScript 7 (the native port) is out, but the type-aware lint tooling targets TypeScript 5.x, so we stay on 5.9.
- **`tsconfig.json`**: the sample's settings: `strict`, `noUncheckedIndexedAccess`, ES2021, `isolatedModules`.
- **`esbuild.config.mjs`**: the sample's config. `obsidian`, `electron`, `@codemirror/*`, `@lezer/*` and Node built-ins are external; output is `cjs`, `es2021`.
- **`eslint.config.mts`**: the sample's config, using `...obsidianmd.configs.recommended`. This is the rule set the directory's automated review runs.
- **`.npmrc`**: `tag-version-prefix=""`, so tags are `1.0.0` with no leading `v`.
- **`LICENSE`**: the standard MIT text, `Copyright (c) 2026 <your name>`. This is a from-scratch rewrite with no copied code, so the original notice isn't required. If any code is ever adapted, add `Copyright (c) 2023 Ryota Ushio` as well.
- **`README.md`** sections:
  - What it does, with a GIF or screenshot.
  - Syntax.
  - Numbering rules.
  - Settings.
  - Styling (CSS variables).
  - Limitations (§6).
  - Comparison with similar plugins.
  - Manual installation.
  - **Acknowledgements:** "Inspired by [LaTeX-like Theorem & Equation Referencer](https://github.com/RyotaUshio/obsidian-latex-theorem-equation-referencer) by Ryota Ushio (MIT). Equation Refs reimplements only its equation-numbering and referencing idea, from scratch."
  - License.
- **Git:** `git init -b main` in the new folder. I'll ask before making any commits.

## 8. Publishing checklist (checked against docs.obsidian.md, October 2026)

The process changed in 2026. You no longer open a pull request to `obsidian-releases`. Submission now goes through **community.obsidian.md**, and an automated review based on `eslint-plugin-obsidianmd` checks **every release**. Errors block installation; warnings are informational.

**Code rules** (enforced by `npm run lint`; we aim for 0 errors and 0 warnings)
- [ ] No `console.log`; only `console.error` for real errors.
- [ ] No `innerHTML`, `outerHTML` or `insertAdjacentHTML`. Use `createEl`, `createSpan` and `el.empty()`.
- [ ] No inline styles (`el.style.*`); use classes and data attributes only.
- [ ] No regex lookbehind, because some iOS versions don't support it.
- [ ] No global `app`; use `this.app`. No private APIs (`editor.cm`, `internalPlugins`, monkey patches).
- [ ] Use `activeDocument` and `activeWindow`, `window.setTimeout`, and `instanceOf` where the lint suggests them.
- [ ] Everything registered through `registerEvent`, `registerEditorExtension` and `register()`; ViewPlugins call `offref` in `destroy()`. No leaf detaching in `onunload`.
- [ ] Settings use `getSettingDefinitions()` with no `display()`. That matches minAppVersion 1.13.0 (lint rules `settings-tab/*` and `no-unsupported-api`).
- [ ] All UI strings in sentence case. No settings heading at all, since there's only one section.
- [ ] No commands, so the command-ID and hotkey rules don't apply. If commands are added later: no plugin id in the ID, no default hotkeys.
- [ ] No sample code or placeholder class names left over.
- [ ] No Node or Electron imports, so `isDesktopOnly: false`.
- [ ] `manifest.json` passes `obsidianmd/validate-manifest` (linted via its own block in `eslint.config.mts`, because the recommended config skips it). The description is 10–250 characters, starts with a capital letter, ends with a period, and uses only `A-Za-z0-9`, whitespace and `.,!?'"-`, so **no parentheses**. `name`, `id` and `description` must not contain "obsidian" or "plugin".

**Repository and release**
- [ ] `README.md`, `LICENSE` and `manifest.json` at the repository root.
- [ ] The `version` in `manifest.json` on the default branch's HEAD equals the release tag, e.g. `1.0.0`.
- [ ] GitHub release (created and published by `release.yml` when a version tag is pushed) has `main.js`, `manifest.json` and `styles.css` attached as separate files.
- [ ] `versions.json` updated (`npm version patch|minor|major` does this).

**Submission**
1. Sign in at community.obsidian.md and connect GitHub.
2. Choose **New plugin**, enter the repository URL, agree to the Developer policies, and submit.
3. Fix anything the automated review reports, then publish a new release with a higher version number.
4. Optional: post in the forum's Share & showcase section and in Discord `#updates`.

## 9. Milestones

1. **Scaffold.** Create the folder, copy this plan in as `PLAN.md`, run `git init`, add the config files, LICENSE and README skeleton, and `npm install`. Done when `npm run build` and `npm run lint` pass on an empty plugin.
2. **Core plus tests.** `core/*` and vitest tests: numbering, tags and notag, block-link parsing, `blockIdAfterMath`, format.
3. **Indexes.** `ReferenceIndex` and `EquationNumbers`, with debounced rebuilds and change detection.
4. **Reading view.** Equation numbers and references, including embeds and the PDF fallback.
5. **Live Preview.** The equation-number ViewPlugin, then the reference widget.
6. **Settings and polish.** Declarative settings tab, CSS variables, `onunload` re-render.
7. **Release prep.** README with GIF, `test-vault`, a clean lint run, workflows, a `1.0.0` tag, and the draft release.

## 10. Verification

- **Automated:** `npm run build`, `npm run lint` (0 errors, aim for 0 warnings) and `npm test` must all pass. CI runs the same on Node 22 and 24.
- **Manual,** in `test-vault/`, using a symlink from `test-vault/.obsidian/plugins/equation-refs` to the build output:
  - **`Maxwell.md`:** six equations:
    - two labelled and linked
    - one labelled but not linked
    - one with `\tag{*}`
    - one with `\notag`
    - one inside a callout
  - **`Notes.md`:**
    - cross-note links
    - an aliased link
    - an embed `![[Maxwell#^gauss]]`
    - a link inside a code block
  - **Check:**
    1. In Reading view, only linked equations show (1), (2), and references show `(1)` or `Maxwell (1)`.
    2. In Live Preview, the same; putting the cursor in a link shows raw source; clicking opens it; Ctrl/Cmd-hover shows a preview.
    3. Adding or removing a link in `Notes.md` makes `Maxwell.md` renumber within about a second, in both modes, without reopening.
    4. **Export to PDF** from both notes shows the numbers and the formatted references.
    5. The embed shows its number.
    6. Changing a format setting updates open views.
    7. Disabling the plugin removes all numbers and restores link text.
    8. Scrolling a 2,000-line note full of math stays smooth. The DevTools performance panel should show no `renderMath` calls from us.
- **Things to confirm early,** in milestone 4, before building on them:
  - `SectionCache.type` for `$$` blocks is `'math'`.
  - The PDF post-processor receives the whole document with top-level `.math-block` children.
  - `getSectionInfo` text includes the `^id` line.
  - Adjust only the lookup code if any of these turn out differently.

## 11. Known limitations (v1, documented in the README)

- Only top-level `$$` blocks are numbered.
- One number per block; no per-line numbering in `align`.
- Numbers restart in each note, with no chapter prefix.
- Embeds and canvas links don't count as references.
- Hover-preview numbering depends on the section info Obsidian provides.

## Sources

- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Submission requirements: https://docs.obsidian.md/community-directory/submission-requirements-for-plugins
- Submit your plugin: https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
- Community directory setup: https://docs.obsidian.md/community-directory/set-up-and-claim
- Declarative settings (1.13+): https://docs.obsidian.md/Plugins/User+interface/Settings
- Sample plugin (2026 layout, eslint, release workflow, AGENTS.md): https://github.com/obsidianmd/obsidian-sample-plugin
- Review lint rules: https://github.com/obsidianmd/eslint-plugin
- API types: `obsidian@1.14.4` `obsidian.d.ts`: `SectionCache`, `MarkdownPostProcessorContext.getSectionInfo`, `editorLivePreviewField`, `editorInfoField`, `registerHoverLinkSource`, `PluginSettingTab.getSettingDefinitions`.
