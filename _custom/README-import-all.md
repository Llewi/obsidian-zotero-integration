# "Import all items" and collection folders

Status (2026-11-07): **Option 2 implemented** (plugin command). It has not
been built or tested yet, because there was no Node.js toolchain in the
authoring environment. See [Build & test](#build--test).

Related: [README.md](README.md) (how the plugin talks to Zotero),
[README-template.md](README-template.md) (import template),
[README-open-in-zotero-reader.md](README-open-in-zotero-reader.md).

---

## 1. What it does

The command **"Zotero Integration: Import all items (all libraries)"** imports
every item of every Zotero library (personal library and groups) with one
import format. It never opens the Zotero citation picker.

Flow:

1. Pick the import format. The dialog is skipped if only one format is
   configured.
2. The plugin lists all citekeys per library and shows a confirmation with
   the counts.
3. Import runs in batches. A progress notice reads
   `importing "<library>" (1/2): 150/812`.
4. A summary notice shows notes written, failures, and citekeys that exist in
   several libraries. Lists of these are printed in the developer console.

While the import is running, running the command again offers **Stop import**.
It stops after the current batch.

**Which folder notes go to** comes entirely from the import format's *Output
path*, not from the command. Collection subfolders therefore work for normal
single-item imports as well (section 2).

## 2. Collection subfolders: settings only

`processItem` fetches `item.collections` (BBT `item.collections` with
parents) **before** the output path is rendered (`src/bbt/export.ts:310`).
Each collection has `key`, `name`, and `fullPath`, which is the
parent-to-child path joined with `/` (`getCollectionFromCiteKey`,
`src/bbt/jsonRPC.ts:55`).

Current settings (also in [config.md](config.md)):

```nunjucks
Output path:
zotero/notes/{% if collections and collections.length %}{{ (collections | sort(false, false, "fullPath") | first).fullPath }}{% else %}_Unfiled{% endif %}/@{{citekey}}.md

Image output path:
zotero/images/{% if collections and collections.length %}{{ (collections | sort(false, false, "fullPath") | first).fullPath }}{% else %}_Unfiled{% endif %}/{{citekey}}/
```

- Nested collections become nested folders. Missing folders are created
  (`mkMDDir`).
- The `sort` makes the folder choice deterministic for items in several
  collections. The first `fullPath` in alphabetical order wins.
- Items without a collection go to `_Unfiled`.
- ⚠️ **The file name changed from `{{citekey}}.md` to `@{{citekey}}.md`.**
  Re-importing items that were imported with the old setting creates
  **new** files, and the old notes stay where they are. Either drop the `@`
  from the new output path, or rename/move the existing notes first. The
  template's `[[@{{relation.citekey}}]]` links expect the `@` form.
- Recommended template addition, so a note knows *all* its collections
  (not done yet):
  `collections: [{% for c in collections %}"{{c.fullPath}}"{% if not loop.last %}, {% endif %}{% endfor %}]`

## 3. Implementation

| File | Role |
| --- | --- |
| `src/bbt/importAll.ts` | Core logic, no UI. `listAllLibraryCiteKeys(database)` (line 68): `isZoteroRunning`, then `user.groups`, then per library the BBT library export → `LibraryCiteKeys[]`. `importAllItems(params, libraries, options)` (line 129): batching, retry, abort, cancel, progress callback. `findDuplicateCiteKeys` (line 98). |
| `src/main.ts` | Command `zdc-import-all` (line 134), interactive `importAllCommand()` (line 238), scriptable `importAll(formatName, showProgress?, libraries?)` (line 300) |
| `src/ImportAllModals.ts` | `pickExportFormat` (fuzzy picker) and `confirm` (OK/Cancel modal) |
| `src/bbt/LoadingModal.ts` | New static `suppress()` / `unsuppress()`. While suppressed, the per-request "Fetching…" modals are not shown |
| `src/bbt/tests/importAll.test.ts` | Unit tests for batching, retry, abort, cancel, and duplicate detection (with mocked `exportToMarkdown`) |

Behaviour details:

- **Batches never mix libraries.** `exportToMarkdown` fetches item data with
  the library of the *first* citekey (`export.ts:607`), so every batch comes
  from one library.
- **Probe first.** Items are imported one at a time until the first note has
  been written, then in batches of 50 (`batchSize`).
- **Abort.** If 3 items fail before any note is written, the run aborts
  (`ABORT_AFTER_INITIAL_FAILURES`). This usually means a template error or
  Zotero not answering. It avoids one error notice per item of the whole
  library.
- **Retry.** If a batch fails as a whole (`exportToMarkdown` throws or returns
  nothing), it is retried item by item. Only the items that really fail end up
  in `failed`.
- **No notes are opened** after the import. The *open note after import*
  setting is not applied (the run uses `exportToMarkdown` directly, like
  `runImport`).
- **Loading modals are suppressed** for the run. **Error notices are not**:
  `jsonRPC.ts` and template errors still show their notices.
- **Script API:**
  `await app.plugins.plugins['obsidian-zotero-desktop-connector'].importAll('<format name>')`
  returns `ImportAllResult`
  (`{ requested, written, failed, cancelled, aborted, duplicateCiteKeys }`),
  or `null` if Zotero can't be reached or a run is already active.

## 4. Known limitations

| # | Limitation | Notes / fix |
| --- | --- | --- |
| 1 | **Collection changes cause duplicate notes.** If an item moves to another collection in Zotero, the next import computes a new path and creates a new file. The old note keeps its persisted annotations and manual edits, and the new note re-imports all annotations | Move existing notes by citekey before writing (section 5, step 4) |
| 2 | One note per item, so an item in several collections appears in **one** folder only | By design. List all collections in frontmatter (section 2). Duplicating notes per collection (analysis option 3) would make `[[@citekey]]` ambiguous and split annotations |
| 3 | The same citekey in two libraries can map to the **same file** (the output path doesn't include the library). The later library overwrites the earlier one | Reported as `duplicateCiteKeys`. Fix: add the library to the path. Item data has `libraryID`; a library name is not available in the path template |
| 4 | Collection names: `:` `"` `<` `>` `|` → ` - `, `*` `?` removed (`replaceIllegalChars`). A `/` inside a collection name creates an extra folder level | |
| 5 | **Speed.** Requests to Zotero are strictly serial (`ZQueue`, `maxConcurrent = 1`). Each item needs about 5 RPCs (issue date, collections, bibliography, attachments, relations, and related items are processed in full), plus `pdfannots2json` per PDF | Expect minutes for hundreds of items. The library export for listing citekeys is run for every library on each start |
| 6 | Library listing skips entries without a citekey **or without a title** (`getCiteKeyExport`) | Untitled items are never imported |
| 7 | Items deleted in Zotero keep their notes. Nothing is ever deleted | Matches the "additions only" goal |
| 8 | Re-running is a full re-import. Content outside `persist` blocks is regenerated, and only annotations newer than the note's import-date marker are added. Edited annotations are added again (see README-template.md, section 5) | Section 5, steps 3 and 5 |
| 9 | Error notices are not suppressed. A partly broken library can still produce many notices | A real "silent" flag in `jsonRPC.ts` (section 5, step 2) |

## 5. Roadmap: scheduled runs and incremental sync (from the analysis)

Goal: (1) run the import automatically on a schedule; (2) bring Zotero
changes (new annotations, metadata edits) into existing notes, **additions
only, never deletions**. Option 2 was chosen because both goals need logic
inside the plugin. Scripts (option 1) can't schedule or keep state, and
per-collection imports (option 3) would have to keep duplicate notes
consistent.

Keep everything going through **one function** (today `importAll`, later
`syncAll({ silent, changedOnly })`). The command, the timer, startup, and an
`obsidian://zotero-sync` link all call it.

### Step 1: done

Command, batching per library, progress, cancel, loading-modal suppression,
script API.

### Step 2: scheduler

- `this.registerInterval(window.setInterval(() => this.importAll(fmt, false), minutes * 60_000))`,
  plus one run in `this.app.workspace.onLayoutReady`. Add settings: interval,
  sync on startup, which import format to use.
- Check `isZoteroRunning(database, true)` first (silent). Skip the run if
  Zotero isn't running.
- **Overlap guard:** `importAllRunning` already exists; `importAll` returns
  `null` while a run is active.
- **Real silent mode:** pass a `silent` flag through the `jsonRPC.ts`
  functions so background runs show no error notices. Collect errors in the
  result instead. `LoadingModal.suppress()` already covers the modals.
- **Per-device switch:** with a synced vault, only one desktop should run the
  scheduler, or file conflicts follow. Store the on/off switch in
  `localStorage` (per device), not in `data.json` (synced).
- Optional: `this.registerObsidianProtocolHandler('zotero-sync', …)`, so an
  OS-level scheduler (cron, launchd, Keyboard Maestro) can trigger
  `obsidian://zotero-sync`.

### Step 3: template-side duplicate check (no plugin code)

`PersistExtension.prepareTemplateData` passes the retained block contents to
the template as `_retained.<persist id>`. Give each native annotation a block
ID and skip annotations already present:

```nunjucks
{% for a in annotations %}
{% if a.source != "zotero" or ("^" + a.id) not in (_retained.annotations or "") %}
… render annotation … ^{{a.id}}
{% endif %}
{% endfor %}
```

This replaces the `dateafter lastImportDate` filter for native annotations.
Edited annotations then no longer get added twice, and the import-date line no
longer has to stay last. PDF-embedded annotations have no stable key: keep the
date filter for them. **Untested.** Check how block IDs render inside
callouts.

### Step 4: move notes by citekey before writing

Before `exportToMarkdown` writes, find an existing note whose frontmatter
`citekey` matches, e.g. by building a `citekey → TFile` map once per run from
`app.metadataCache`. If its path differs from the newly computed path, move
it with `app.fileManager.renameFile(file, newPath)`, which also updates links.
Moving deletes nothing, so it fits "additions only". This needs a hook in
`exportToMarkdown`'s `queueRender` (`export.ts:640`), or a pre-pass that
computes paths.

### Step 5: changed-only sync

- Zotero 7's **local API** (`http://localhost:23119/api/`, enabled in Zotero
  Settings → Advanced) mirrors the Web API. The Web API supports
  `GET /users/0/items?since=<libraryVersion>&format=versions` and returns the
  `Last-Modified-Version` header. Annotations are items there too, so new
  highlights show up. **Unverified:** whether the local API supports `since`.
  Test this first.
- Map each changed key to its top-level item (annotation → attachment →
  parent). Then get the citekey with BBT `item.citationkey(["<libraryID>:<key>"])`.
  Import only those citekeys with `importAllItems`.
- Store `lastVersion` per library (per device, like the scheduler switch).
- Fallback if `since` doesn't work: a full import at a longer interval.

### Safety for background writes

- `exportToMarkdown` writes with `app.vault.modify`. For background runs,
  switch to `app.vault.process`, and consider skipping notes open in the
  active editor, so typing isn't overwritten.
- Fields edited in Obsidian (`status`, `dateread`, `Contribution::`) must
  sit inside `persist` blocks, otherwise every sync resets them (see
  README-template.md, TODO 4).

## Build & test

```sh
npm install            # or yarn (the repo's clean script uses yarn)
npm run check-types    # tsc --noemit
npm run lint           # eslint ./src
npm test               # jest, incl. src/bbt/tests/importAll.test.ts
npm run build          # esbuild production build -> main.js
```

Then copy `main.js` (with `manifest.json` and `styles.css`) into
`<vault>/.obsidian/plugins/obsidian-zotero-desktop-connector/` and reload the
plugin.

Manual test checklist:

1. Zotero closed: the command shows "could not list the Zotero libraries".
2. One import format: no format picker. Several formats: picker appears.
3. Cancel in the confirmation: nothing is written.
4. Break the template on purpose: the run aborts after 3 failed items, with a
   few error notices.
5. Normal run on a test vault: notes land in collection subfolders, the
   progress notice updates, and the summary appears.
6. Run the command during an import: "Stop import" stops after the current
   batch.
7. Run again: no duplicate notes, and only new annotations are added.
