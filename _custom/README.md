# Custom work on obsidian-zotero-integration: handoff document

Single source of truth for the customisation work on this fork of the
Obsidian **Zotero Integration** plugin (upstream v3.2.1, local version
`3.2.1.1`). It replaces the four earlier documents, which are now in
[`archive/`](archive/). They are still useful for full detail, but this file is
meant to be enough on its own.

Last updated: 2026-11-07.

---

## 0. Resume here

### User goals

1. **Arrange the bibliography in Obsidian.** Each Zotero item becomes one
   Markdown literature note. Notes are arranged in Markdown/Canvas files and
   in folders that mirror Zotero collections.
2. **Open the PDF (or EPUB or snapshot) in Zotero's reader** from a note,
   including **jumping to a specific annotation or page**.
3. **Import everything without the Zotero picker.** Done (command).
4. **Later:** run the import **on a schedule**, and **sync Zotero changes into
   notes, additions only** (never delete).

### Current state

| Area | State |
| --- | --- |
| Reader links in notes (variant **A1**, template only) | ✅ implemented in `_custom/template.md`. ⚠️ Not yet confirmed working in a real vault |
| Collection subfolders | ✅ via the output path setting (`_custom/config.md`, also in `_custom/data.json`) |
| "Import all items" command (**Option 2**) | ✅ implemented and committed (`2767d9b`). `main.js` was built by the user (contains the command). ⚠️ `check-types`, `lint`, `jest` and a manual vault test have **not** been confirmed |
| Scheduler, silent mode, dedupe, move-by-citekey, incremental sync | ⏳ designed (section 9), not implemented |

### Uncommitted changes at the time of writing

- `_custom/*` docs moved to `_custom/archive/` (staged) and this file
  rewritten.
- `manifest.json`: version `3.2.1` → `3.2.1.1` (user's change). Obsidian
  compares versions as semver. A 4-part version is fine for a local install,
  but don't push it to a release.
- `yarn.lock`: changed by the user's `yarn install`.
- `_custom/data.json` (untracked): copy of the plugin's settings from the
  vault (see section 7).

### Next steps, in recommended order

1. In the repo, run `yarn check-types && yarn lint && yarn test`. Fix
   anything that comes up. Type-checking has never been run on the new code;
   esbuild doesn't type-check.
2. Test in a vault. Use the checklists in section 10. In particular: do reader
   links open at the right annotation or page, and does the import-all command
   work end to end?
3. Resolve the **`@` filename change** (section 7) before a bulk import into
   a vault that already has notes.
4. Continue with the roadmap (section 9): scheduler with silent mode, then
   the template-side duplicate check, then move-by-citekey, then
   changed-only sync.

### Environment notes (for the assistant)

- The sandbox has **no `node` on PATH**, and `~/.nvm` is outside the
  sandbox. Ask the user to run builds and tests, or use the `!` prefix.
- Zotero itself is not reachable from the sandbox. All Zotero/BBT
  behaviour below comes from reading source code, not from live calls.

---

## 1. Files

### `_custom/`

| File | What |
| --- | --- |
| `README.md` | this document |
| `template.md` | the user's **import template** (source copy). The vault uses `zotero/template2.md`, so keep the two in sync manually |
| `config.md` | the user's notes on output path settings |
| `data.json` | copy of the plugin settings (`.obsidian/plugins/obsidian-zotero-desktop-connector/data.json`) |
| `archive/README.md` | full analysis of how the plugin talks to Zotero |
| `archive/README-open-in-zotero-reader.md` | full reader-link research (A1/A2/A3, options B/C, sources) |
| `archive/README-template.md` | full template maintainer notes |
| `archive/README-import-all.md` | full import-all doc, written before this consolidation |

### Plugin source changed or added (commit `2767d9b`)

| File | Change |
| --- | --- |
| `src/bbt/importAll.ts` (new) | core logic: `listAllLibraryCiteKeys`, `importAllItems`, `findDuplicateCiteKeys` |
| `src/ImportAllModals.ts` (new) | `pickExportFormat` (fuzzy picker), `confirm` (OK/Cancel modal; OK has focus, so Enter confirms) |
| `src/bbt/LoadingModal.ts` | static `suppress()` / `unsuppress()`. `open`/`close` become no-ops while suppressed |
| `src/main.ts` | command `zdc-import-all`, `importAllCommand()`, `confirmImportAll()`, scriptable `importAll(formatName, showProgress?, libraries?)`, two state flags, default `confirmImportAll: true` |
| `src/types.ts`, `src/settings/settings.tsx` | setting `confirmImportAll` (toggle "Confirm Before Importing All Items" under General Settings) |
| `src/bbt/tests/importAll.test.ts` (new) | jest tests: batching, probe, retry, abort, cancel, duplicates |

---

## 2. How the plugin talks to Zotero

- **Only** HTTP to the local server that the **Better BibTeX (BBT)** add-on
  runs inside the Zotero desktop app: `http://127.0.0.1:<port>`. The port is
  `23119` for Zotero, `24119` for Juris-M, or custom (`getPort`,
  `src/bbt/helpers.ts:11`). The plugin never reads `zotero.sqlite` and never
  uses the zotero.org Web API. Zotero must be running and BBT installed.
  The plugin is desktop-only.
- Endpoints:
  - `GET /better-bibtex/cayw?probe=true`: health check, cached 30 s
    (`isZoteroRunning`, `src/bbt/cayw.ts:22`).
  - `GET /better-bibtex/cayw?format=…`: the picker (`getCAYW`,
    `getCAYWJSON`).
  - `POST /better-bibtex/json-rpc`: all data access (`src/bbt/jsonRPC.ts`).
  - `GET /better-bibtex/export/library?/<libraryID>/<name>.<translatorId>`:
    whole-library CSL-JSON export (`getCiteKeyExport`, `jsonRPC.ts:567`). Used
    for autocomplete and now also for import-all.
- JSON-RPC methods the plugin uses:

  | Method | Used for |
  | --- | --- |
  | `item.export` | item JSON (BBT JSON translator `36a3b0b5-…`), and CSL JSON for the issue date |
  | `item.attachments` | native annotations, plus each attachment's `open` reader link (the plugin ignores that link) |
  | `item.notes` | child notes |
  | `item.collections` | collections, with parents (`includeParents=true`) |
  | `item.bibliography` | formatted bibliography |
  | `item.citationkey` | resolve relations to citekeys |
  | `item.search` | search |
  | `user.groups` | list libraries |

- Items are always addressed by **citekey + libraryID** (`CiteKey`,
  `cayw.ts:125`).
- **All requests are serial:** `ZQueue` has `maxConcurrent = 1`
  (`src/bbt/queue.ts`). Most RPC helpers open a `LoadingModal` ("Fetching…")
  for the duration of each request (9 places in `jsonRPC.ts`) and show a
  `Notice` on error.
- **Annotations come from two sources**, merged into `attachment.annotations`:
  - (A) **Native Zotero annotations** from `item.attachments`, mapped by
    `convertNativeAnnotation` (`export.ts:112`), `source: 'zotero'`.
  - (B) **Annotations embedded in the PDF file**, read by the bundled native
    binary `pdfannots2json` (`extractAnnotations`, `src/bbt/extractAnnotations.ts`),
    mapped by `processAnnotation` (`export.ts:88`), `source: 'pdf'`. The user's
    binary is at `exeOverridePath: /Users/mayrhaus/programs/pdfannots2json`.
- **Notes:** the HTML is parsed. `data-annotation` elements become
  "Go to annotation" `open-pdf` links, `data-citation` elements become select
  links (`exportNotes.ts`). The result is converted with `htmlToMarkdown`.
- **Main import pipeline:** `exportToMarkdown(params, explicitCiteKeys?)`
  (`export.ts:594`).
  1. Citekeys come from the picker if none are given.
  2. `getItemJSONFromCiteKeys` uses the **library of the first citekey**
     (`export.ts:607`).
  3. `processItem` runs for each item (`export.ts:268`). It fetches the date,
     **collections**, bibliography, notes, attachments (`processAttachment`)
     and relations; related items are recursively processed in full.
  4. For each attachment: annotations, then the output path is rendered from
     `{...attachment, ...item}`, then `queueRender`.
  5. Rendering applies `persist` handling, then `vault.modify` or
     `vault.create`.

  Each item costs about 5 RPCs, plus `pdfannots2json` for each PDF.

---

## 3. Opening an item in Zotero's reader: findings

### Zotero URL handlers (`chrome/content/zotero/ZoteroProtocolHandler.mjs`, Zotero `main`)

- `zotero://open-pdf/…` and its alias `zotero://open/…` (same handler) open
  an **attachment** in Zotero's reader:
  - `zotero://open-pdf/library/items/<attachmentKey>`
  - `zotero://open-pdf/groups/<groupID>/items/<attachmentKey>`
  - legacy: `zotero://open-pdf/<libraryID>_<key>/<page>`
- Query parameters:

  | Parameter | Effect |
  | --- | --- |
  | `page=N` | **physical** page, 1-based (`pageIndex = N-1`) |
  | `annotation=<annotationKey>` | jump to and select that annotation |
  | `cfi=<urlencoded>` | EPUB position |
  | `sel=<urlencoded CSS selector>` | snapshot position |

- The handler rejects anything that is not a file attachment
  (`if (!item.isFileAttachment()) return`). It opens through
  `Zotero.FileHandlers.open`, so PDFs, **EPUBs and snapshots** all open in the
  reader. It respects `openReaderInNewWindow`.
- `zotero://select/library/items/<key>` (or `groups/<id>/…`) only selects
  the item in the library pane.

### What BBT adds

- **`@citekey` in `zotero://` URLs.** BBT patches
  `Zotero.API.getResultsFromParams` so that the key `@ck` (or `bbt:ck`) is
  replaced with the item key of that citekey. This works for `select`:
  `zotero://select/library/items/@smith2020` selects the item.
  `open-pdf/…/@smith2020` resolves to the **parent** item, so it is rejected
  and **does nothing**. A citekey alone can't open the reader. Open BBT
  feature request: #2214.
- **`item.attachments(citekey, library | "*")`** returns, for each
  attachment, `{ open: "zotero://open-pdf/<library|groups/N>/items/<attKey>", path, annotations? }`.
  This is the citekey → reader-link resolver.
- **`viewer.viewPDF(itemURI, page0)`** opens the item's best **PDF**. It
  takes a Zotero URI (`http://zotero.org/users/N/items/KEY`) with a zero-based
  page. It can't open EPUBs or snapshots.
- CAYW `select=true` selects items in Zotero. Not useful here.

### What can't open the reader

- The **Zotero Web API** has no control over the desktop app.
- The **Zotero 7 local API** (`/api/…`) is read-only data with no UI actions.
- The BBT `debug-bridge` add-on (runs arbitrary JS) could, but it's a
  security risk and isn't needed.

### Obsidian side

- Markdown links `[x](zotero://…)` open through the OS.
- In **Canvas**, use **file cards** or **text cards** with the Markdown link.
  Not *link (web embed)* cards: their iframe can't load a `zotero://` URL.

---

## 4. Attachment keys and annotation keys

Every object in Zotero is an "item" with its own 8-character key:

```
Parent item  (journal article)          key ABCD1234   ← the citekey points here
├── Attachment (PDF/EPUB/snapshot)      key 7XK2Q9PM   ← attachmentKey, required by open-pdf
│     ├── Annotation (Zotero reader)    key RMRBFIVX   ← only as ?annotation=
│     └── …
└── Child note                          key N0TE5678   ← not openable in the reader
```

- Annotations **embedded in the PDF file** have no Zotero key, so you can only
  link to their page.
- Full annotation link:
  `zotero://open-pdf/library/items/<attKey>?page=<physical>&annotation=<annotKey>`
- Finding a key in the Zotero UI (keys aren't shown):
  - storage folder name (`~/Zotero/storage/<attKey>/`);
  - links in a note created from annotations;
  - *Tools → Developer → Run JavaScript*:
    `return ZoteroPane.getSelectedItems()[0].key`;
  - the web library URL.
- **In the plugin:** `attachment.itemKey` and `attachment.pdfURI`. The
  **Data explorer** command shows all fields for an item.

---

## 5. Reader-link strategies

| Strategy | When the link is computed | Status |
| --- | --- | --- |
| **A1** template only | at import | ✅ **implemented** in `template.md` |
| **A2** fix the plugin's link builders | at import | open (section 8 lists the bugs) |
| **A3** store citekey + annotation key, resolve when clicked (`obsidian://zotero-reader?citekey=…&annotation=…`) | when clicked | open. Survives PDF replacement |
| **B** plugin command / `obsidian://` handler: `item.attachments(ck,"*")`, pick a PDF or else EPUB/HTML, `window.open(att.open + "?page=N")` | when clicked | open. Sketch in `archive/README-open-in-zotero-reader.md`, section 5 |
| **C** external script (`curl` JSON-RPC + `jq` + `open`) | when clicked | documented only |

The reader-link recipe for an attachment (handles PDF, EPUB, snapshot, and
upper-case `.PDF`):

```nunjucks
{{ att.pdfURI or (att.desktopURI | replace("zotero://select", "zotero://open-pdf")) }}
```

- `pdfURI` is only set when `path` ends with lowercase `.pdf`
  (`export.ts:82`).
- `desktopURI` on an attachment is its **select** link. Replacing `select`
  with `open-pdf` works because both links have the same path.

Annotation links:

```nunjucks
{# native (source == "zotero") #}  {{base}}?{% if a.page %}page={{a.page}}&{% endif %}annotation={{a.id}}
{# embedded (source == "pdf")  #}  {{base}}{% if a.page %}?page={{a.page}}{% endif %}
```

Always use `a.page` (physical page) in `page=`. Use `a.pageLabel` only as
the visible link text.

---

## 6. Import template (`_custom/template.md`)

### How it's used

- Plugin settings → Import formats → **Template file**. The path is
  vault-relative and the file must be **inside the vault**; the loader uses
  `metadataCache.getFirstLinkpathDest`. The current vault path is
  `zotero/template2.md`.
- Rendered with Nunjucks 3.2.4, `autoescape: false`, once per item.

### Section map

| Lines | Section | Re-generated on re-import? |
| --- | --- | --- |
| 1–12 | frontmatter: `category`, `tags` (`allTags` string), `citekey`, `status: unread`, `dateread`, **`zotero-select`**, **`zotero-reader`** (first `.pdf`, otherwise first attachment with a `path`) | yes. ⚠️ `status` and `dateread` are reset |
| 14–15 | `[!Cite]` `bibliography` | yes |
| 17–21 | `[!Synth]` with `Contribution::` and `Related::` (relations) | yes. ⚠️ manual `Contribution` is lost |
| 23–44 | `[!md]` Dataview inline metadata | yes |
| 46–50 | `[!LINK]`: "Show in Zotero" + for each attachment with a `path`: `file://` link · "Open in Zotero reader" | yes |
| 52–59 | `[!Abstract]`, `# Notes` (`markdownNotes`) | yes |
| 62–71 | `calloutHeader(type, color)` macro | — |
| 73–93 | `# Annotations` in `{% persist "annotations" %}`: new annotations (`date` after `lastImportDate`), each followed by a `> [p. <label>](reader link)` line | **kept** (append only) |
| 95 | `{# pointer comment #}` | — |

### Data the template uses

- **Item:** `citekey`, `title`, `date`, `creators[]`, `itemType`, the usual
  Zotero fields, `allTags`, `relations[]`, `bibliography`, `markdownNotes`,
  `desktopURI` (select), `attachments[]`, `annotations[]`, `importDate`,
  `lastImportDate`, `isFirstImport`, and **`collections[]`** (`key`, `name`,
  `fullPath`).
- **`annotations`** = annotations of the **first attachment that has any**
  (`getTemplateData`, `export.ts:582`).
- **Attachment:** `title`, `path`, `itemKey`, `desktopURI` (select),
  `pdfURI` (open-pdf, lowercase `.pdf` only), `annotations[]`.
- **Annotation:**
  - `source` (`zotero` or `pdf`).
  - `id`: the Zotero key for native annotations. For `pdf` annotations it is
    *not* a Zotero key; never put it in a link.
  - `page`: physical page. For native annotations it's **missing on page 1**
    (bug) and for EPUB/snapshot.
  - `pageLabel`, `type`, `annotatedText`, `comment`, `color`,
    `colorCategory`, `date` (`dateModified` for native), `tags`,
    `imageRelativePath`, `attachment`.
  - `desktopURI`: the plugin's own link. It is buggy (it uses the page label)
    and the template deliberately doesn't use it.

### Rendering behaviour that is easy to get wrong

- **`persist`:** renders `%% begin id %%<kept><new>%% end id %%`
  (`PersistExtension`, `template.env.ts:148`). Kept content is never
  re-rendered, so template changes only affect annotations imported later. To
  rebuild, empty the block and re-import; manual edits there are lost.
  Everything outside `persist` is overwritten.
- **Import-date marker:** if the output has a `persist` block, the plugin
  appends `%% Import Date: <ISO> %%`. `getLastExport` only finds it as the
  **very last line** (`/…%%\n$/`). If anything comes after it,
  `lastImportDate` falls back to 1970, and **all annotations are appended
  again**.
- **Editing an annotation in Zotero** updates its `dateModified`, so it is
  appended again on the next import (duplicate).
- **Whitespace:**
  - The frontmatter must start at byte 0.
  - `{%-`/`-%}` strip whitespace only, not `>`.
  - Macros aren't hoisted; define them before first use.
  - The trailing `.` after some callouts are leftovers from the original
    template.
- **Filters:**
  - Nunjucks built-ins. `selectattr` supports the one-argument form only.
  - `filterby(prop, cmd, …)`: `startswith`/`endswith`/`contains` are
    **case-insensitive**; `dateafter`/`dateonorafter`/`datebefore`/
    `dateonorbefore` take moment values.
  - `format("…")` (moment) and `setAttribute`.
- `_retained.<persist id>` (the kept block text) is available in the template
  context (`PersistExtension.prepareTemplateData`). It's the basis for the
  planned duplicate check (section 9).

### Template TODOs

1. Existing notes have no annotation reader links. Empty the annotations
   block once and re-import, after backing up any manual edits.
2. Only the first annotated attachment is shown. Loop
   `attachments` → `att.annotations` instead.
3. Note annotations (`type == "text"`) show an empty quote. Render
   `a.comment`, and `![[{{a.imageRelativePath}}]]` for image annotations.
4. Move `Contribution::`, `status` and `dateread` into a persist block:
   `{% persist "synth" %}{% if isFirstImport %}…{% endif %}{% endpersist %}`.
5. `tags:` is a comma string, not a YAML list.
6. Add `collections: [{% for c in collections %}"{{c.fullPath}}"{% if not loop.last %}, {% endif %}{% endfor %}]`
   to the frontmatter.
7. Check that `a.page` from `pdfannots2json` is really the physical page
   (Data explorer, on a PDF whose page labels differ from physical pages).

---

## 7. Plugin settings (`_custom/data.json`, `_custom/config.md`)

- Import format **"Import #1"**:
  - `templatePath: zotero/template2.md`
  - `cslStyle: apa`
  - `outputPathTemplate`:
    ```nunjucks
    zotero/notes/{% if collections and collections.length %}{{ (collections | sort(false, false, "fullPath") | first).fullPath }}{% else %}_Unfiled{% endif %}/@{{citekey}}.md
    ```
  - `imageOutputPathTemplate`: the same, under `zotero/images/…/{{citekey}}/`.
- How the collection folders work:
  - `collections` is fetched before the path is rendered
    (`export.ts:310`).
  - `fullPath` nests parent collections, e.g. `Methods/Survey design`.
  - `sort` makes the choice deterministic for items in several collections.
  - Items without a collection go to `_Unfiled`.
  - Folder names: `:"<>|` become ` - `, and `*?` are removed
    (`replaceIllegalChars`). A `/` inside a collection name adds a folder level.
- ⚠️ **The filename changed** from the earlier `zotero/notes/{{citekey}}.md`
  to `…/@{{citekey}}.md`. Items imported before get a **new** file, and the
  old notes keep their persisted annotations and edits. Decide first: drop the
  `@`, or rename and move the old notes. The template's relation links use
  `[[@citekey]]`.
- `openNoteAfterImport: false`. `noteImportFolder: zotero/notes`.

---

## 8. Known bugs in the upstream plugin (not fixed; candidates for A2)

| Location | Bug |
| --- | --- |
| `export.ts:106`, `:132`, `exportNotes.ts:88`, `basicTemplates/applyBasicTemplates.ts:62` | `?page=` is given the **page label** instead of the physical page. Wrong page, or `NaN`, for journal page numbers or roman numerals. Native annotations probably still land correctly because of `annotation=` (precedence not verified) |
| `export.ts:139` | `if (annotationPosition.pageIndex)`: page index 0 is falsy, so annotations on page 1 get no `page` |
| `export.ts:130` | native annotations only get `desktopURI` for `.pdf` attachments. EPUB/snapshot annotations get no link |
| `export.ts:82` | `pdfURI` only for lowercase `.pdf` |
| `applyBasicTemplates.ts:27-52` | `pdfZoteroLink` / `firstAttachmentZoteroLink` use the **select** link, so they don't open the reader |
| `export.ts:280` | `getLocalURI('select', item.uri, item.itemKey)` passes a string as params, so the fallback URL gets a junk `?KEY=`. Rarely reached, because `item.select` takes precedence |
| `jsonRPC.ts` `getAttachmentsFromCiteKey` | typed as `library: number`, but BBT also accepts `"*"`. It opens a modal and fetches annotations, which makes it heavy for click-time lookups |

---

## 9. Import all items (implemented) and the sync roadmap

### Implemented: command "Zotero Integration: Import all items (all libraries)"

1. `importAllCommand()` (`main.ts`):
   - If an import is already running, it offers "Stop import" and sets the
     cancel flag.
   - Otherwise: `pickExportFormat` (skipped if there's only one format), then
     `listAllLibraryCiteKeys`, then a `confirm` dialog with counts per
     library, then `importAll(format.name, true, libraries)`.
   - The confirmation dialog is optional: setting `confirmImportAll`
     (Settings → General Settings → "Confirm Before Importing All Items",
     default on). When off, the import starts right after the format is
     chosen. The "Stop import" dialog is always shown.
   - In every `confirm` dialog the confirm button (not Cancel) has focus,
     so Enter confirms and Escape cancels.
2. `importAll(formatName, showProgress = true, libraries?)`:
   - Guards against overlapping runs (`importAllRunning`).
   - Shows a persistent progress `Notice` (`setMessage`), hidden in
     `finally`.
   - Calls `importAllItems`.
   - Shows a summary notice. The `failed` and `duplicateCiteKeys` lists go to
     `console.warn`.
   - Returns `ImportAllResult` (`{ requested, written, failed, cancelled, aborted, duplicateCiteKeys }`)
     or `null`.
   - Script access:
     `app.plugins.plugins['obsidian-zotero-desktop-connector'].importAll('Import #1')`.
3. `listAllLibraryCiteKeys(database)`: `isZoteroRunning`, then
   `getUserGroups` (`user.groups`; `id` = libraryID), then for each library
   `getCiteKeyExport`, giving `LibraryCiteKeys[] = { libraryID, name, citeKeys }`.
   Entries without a citekey **or title** are skipped.
4. `importAllItems(params, libraries, { batchSize = 50, suppressLoadingModals = true, onProgress, isCancelled })`:
   - `LoadingModal.suppress()` for the whole run (released in `finally`).
   - Batches never mix libraries, because `exportToMarkdown` uses the first
     citekey's library.
   - **Probe:** batch size 1 until the first note has been written.
   - **Abort:** if 3 items fail before any note is written
     (`ABORT_AFTER_INITIAL_FAILURES`, usually a template error or Zotero
     down), the run stops.
   - **Retry:** a batch that throws or writes nothing is retried item by
     item. Only real failures land in `failed`.
   - Checks for cancellation between batches and between retried items.
   - Notes are not opened afterwards.
   - **Error notices are not suppressed.**

### Limitations of the current implementation

1. **Moved items create duplicate notes.** If an item moves to another
   collection in Zotero, the next import computes a new path and creates a
   new note; the old one remains.
2. **One note per item.** An item in several collections appears in only
   one folder, by design. Duplicating notes would make `[[@ck]]` ambiguous
   and split annotations.
3. **Same citekey in several libraries.** The notes can collide on the same
   path (reported in `duplicateCiteKeys`). The path template has `libraryID`
   but no library name.
4. **Speed.** Requests are serial, with about 5 RPCs per item plus related
   items and `pdfannots2json`. Expect minutes for hundreds of items.
5. **Every run is a full re-import.** Content outside persist blocks is
   regenerated, and annotations are appended by date, so edited annotations
   duplicate.
6. **Error notices are not silenced.**

### Why Option 2

Option 1 (a script calling `runImport`) can't schedule or keep state.
Option 3 (one import per collection) creates duplicate notes that a sync
would have to keep consistent. Both goals, scheduling and additive sync,
need state and timers inside the plugin.

### Roadmap: keep everything behind one function, later `syncAll({ silent, changedOnly })`

1. **✅ Step 1:** command, batching, probe, abort, retry, progress, cancel,
   modal suppression, script API.
2. **Step 2: scheduler.**
   - Run on a timer:
     `this.registerInterval(window.setInterval(() => this.importAll(fmt, false), min*60_000))`,
     plus one run in `workspace.onLayoutReady`.
   - Settings: interval, run on startup, which format.
   - Check `isZoteroRunning(db, true)` first and skip silently if it's down.
     The `importAllRunning` flag already prevents overlapping runs.
   - **Real silent mode:** thread a `silent` flag through the `jsonRPC.ts`
     helpers, so errors are collected instead of shown as notices.
   - **Per-device switch** stored in `localStorage`, not `data.json`, which
     syncs. With a synced vault, only one desktop should run the scheduler.
   - Optional: `registerObsidianProtocolHandler('zotero-sync', …)`, so an
     OS scheduler can trigger a run.
3. **Step 3: template-side duplicate check** (no plugin code). For native
   annotations, append ` ^{{a.id}}` and render only if
   `("^" + a.id) not in (_retained.annotations or "")`. This replaces the
   `dateafter` filter for native annotations. Keep the date filter for `pdf`
   annotations, which have no stable key. Untested; check how block IDs render
   inside callouts.
4. **Step 4: move notes by citekey.** Before writing, build a
   `citekey → TFile` map from `metadataCache` frontmatter. If a note's path
   changed, use `app.fileManager.renameFile`, which updates links. It moves
   rather than deletes, so it stays additive. Hook it into `queueRender`
   (`export.ts:640`) or a pre-pass.
5. **Step 5: changed-only sync.**
   - The Zotero 7 local API (`http://localhost:23119/api/`; enable
     *Settings → Advanced → allow other applications*) mirrors the Web API.
     Query `GET /api/users/0/items?since=<version>&format=versions` and read
     the `Last-Modified-Version` header. Annotations are items there too.
     **Unverified:** whether the local API supports `since`. Test this first.
   - Map each changed key to its top-level item, then to a citekey with
     `item.citationkey(["<libID>:<key>"])`, then pass those to
     `importAllItems`.
   - Store `lastVersion` per library, per device.
   - Fallback: a full import at a longer interval.
6. **Background-write safety.** Use `vault.process` instead of `modify`, and
   consider skipping notes that are open in the active editor. Fields edited
   in Obsidian must live in persist blocks (template TODO 4).

### Additive semantics (already true today)

- Annotations deleted in Zotero stay in the note.
- Items deleted in Zotero keep their notes.
- Nothing is ever deleted by an import.
- Metadata outside persist blocks follows Zotero, which is the intended
  direction (Zotero → Obsidian).

---

## 10. Verification status and checklists

**Verified by reading the source:**
- the Zotero protocol handler;
- the BBT `item.attachments`, `viewer.viewPDF` and `@citekey` patch;
- the plugin's data flow;
- the template whitespace, checked by tracing it by hand.

**Not verified:**
- live behaviour of any link;
- Zotero's precedence between `page` and `annotation`;
- the meaning of `pdfannots2json`'s `page`;
- the local API `since` parameter;
- type-check, lint and jest of the new code;
- the import-all run in a vault.

Build and test (the user runs these):

```sh
yarn install
yarn check-types     # tsc --noemit
yarn lint
yarn test            # includes src/bbt/tests/importAll.test.ts
yarn build           # → main.js; copy main.js, manifest.json, styles.css to <vault>/.obsidian/plugins/obsidian-zotero-desktop-connector/
```

**Template / reader links:**
1. Data explorer on a test item renders without errors.
2. An item **without attachments**: valid YAML, no `zotero-reader` key.
3. A PDF with **native** annotations, including one on **page 1**: each link
   opens the reader and selects the highlight.
4. A PDF with **embedded** annotations: the link opens at the right physical
   page.
5. **EPUB / snapshot** items: `zotero-reader` and the annotation links open
   Zotero's reader.
6. Re-import: no duplicates, and the `%% Import Date … %%` line is still last.
7. In a **Canvas** file card, clicking a reader link opens Zotero.

**Import all:**
1. Zotero closed: "could not list the Zotero libraries".
2. One format: no picker. Several formats: the picker appears.
3. Cancelling the confirmation writes nothing. Enter in the dialog starts
   the import. With "Confirm Before Importing All Items" off, no dialog
   appears.
4. A deliberately broken template aborts after 3 items.
5. A normal run: notes land in collection folders, progress updates, and the
   summary appears.
6. Running the command during an import: "Stop import" works.
7. A second run: no duplicate notes; only new annotations are added.

---

## 11. Sources

- Zotero protocol handler: <https://github.com/zotero/zotero/blob/main/chrome/content/zotero/ZoteroProtocolHandler.mjs>
- BBT JSON-RPC source: <https://github.com/retorquere/zotero-better-bibtex/blob/master/content/json-rpc.ts>
- BBT `@citekey` patch: <https://github.com/retorquere/zotero-better-bibtex/blob/master/content/better-bibtex.ts>
- BBT JSON-RPC docs: <https://retorque.re/zotero-better-bibtex/exporting/json-rpc/>
- BBT citing / CAYW docs: <https://retorque.re/zotero-better-bibtex/citing/>, <https://retorque.re/zotero-better-bibtex/citing/cayw/>
- BBT issues: #2214, citekey-based open-pdf (<https://github.com/retorquere/zotero-better-bibtex/issues/2214>); #769, `@`/`bbt:` select links (<https://github.com/retorquere/zotero-better-bibtex/issues/769>)
- Zotero forum threads:
  - citekey select links are a BBT feature: <https://forums.zotero.org/discussion/comment/414431>
  - `item.attachments` `open`: <https://forums.zotero.org/discussion/comment/364621>
  - open-pdf format and parameters: <https://forums.zotero.org/discussion/comment/424783/>, <https://forums.zotero.org/discussion/comment/456735/>
  - open-pdf → open rename: <https://forums.zotero.org/discussion/107371/>
  - debug-bridge: <https://forums.zotero.org/discussion/75569/>
- Zotero local API: <https://www.zotero.org/support/dev/web_api/v3/local_api>
- Comparable Obsidian plugin, "Zotero Cite Links": <https://community.obsidian.md/plugins/zotero-cite-links>
