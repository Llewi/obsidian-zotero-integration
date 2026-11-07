# Opening a Zotero item in Zotero's reader from Obsidian

**Goal:** Keep the bibliography in Obsidian, as imported literature notes
arranged in Markdown or Canvas files. From any of those notes, open the
item's PDF (or EPUB or snapshot) in **Zotero's built-in reader**, ideally using
only the Better BibTeX (BBT) citekey.

Research date: 2026-11-07. Sources: this repo at v3.2.1, the current Zotero
`main` source, the current BBT `master` source and docs, and Zotero forum
threads. The links are at the end.

## TL;DR

| Question | Answer |
| --- | --- |
| Is it possible? | **Yes.** Zotero has a URL scheme, `zotero://open-pdf/…` (alias `zotero://open/…`), that opens a **file attachment** in its reader. It can jump to a page, an annotation, or an EPUB/snapshot position. Clicking such a link in Obsidian hands it to the OS, which passes it to Zotero. |
| Does it work with only a citekey? | **Not directly.** BBT lets `@citekey` stand in for an item key in `zotero://` URLs, but the citekey resolves to the **parent item**. `open-pdf` refuses anything that is not a file attachment. So `zotero://open-pdf/library/items/@citekey` does nothing. `zotero://select/library/items/@citekey` *does* work, but it only selects the item in the library; it does not open the reader. |
| How do you get from a citekey to the reader? | 1) **Store the attachment link at import time.** This works today, with only a template change. 2) Or **resolve it at click time** through BBT JSON-RPC: `item.attachments(citekey)` returns a ready-made `open` URL (`zotero://open-pdf/<lib>/items/<attachmentKey>`) for each attachment. BBT also has `viewer.viewPDF(itemURI, page)`, which opens the best PDF directly. Option 2 needs a small plugin command or a separate script. |
| What can't do it? | The Zotero **Web API** (cloud) and the Zotero 7 **local API** (`/api/…` on port 23119) are read-only data APIs with no UI actions. |

---

## 0. Key concept: what is the "attachment key"?

The attachment key is the ID Zotero gives the **attachment item itself**: the
PDF, EPUB or snapshot that sits as a child under the parent item. It is not a
note and not an annotation.

Everything in a Zotero library is an "item", and each item has its own
8-character key (e.g. `7XK2Q9PM`):

```
Parent item  (journal article "Smith 2020")   key: ABCD1234   ← citekey smith2020 points here
├── Attachment (Smith_2020.pdf)                key: 7XK2Q9PM   ← the "attachmentKey"
│     ├── Annotation (highlight, p. 12)        key: RMRBFIVX   ← goes in ?annotation=
│     └── Annotation (comment, p. 15)          key: Q2W3E4R5
└── Child note ("My summary")                  key: N0TE5678
```

| Thing | Has its own key? | Works in `zotero://open-pdf/…/items/<key>`? |
| --- | --- | --- |
| Parent item (what the citekey points to) | yes | no, it isn't a file |
| **Attachment** (PDF/EPUB/snapshot) | yes | **yes, this is the one** |
| Child note (item notes) | yes | no, it isn't a file |
| Annotations made in Zotero's reader | yes | only as the `?annotation=<key>` parameter, alongside the attachment key |
| Annotations embedded in the PDF file (Acrobat, Preview…) | no, they're part of the PDF, not the database | no |

So a full link to a highlight looks like this:
`zotero://open-pdf/library/items/<attachmentKey>?page=12&annotation=<annotationKey>`

### Finding it from the Zotero UI

As far as I know, Zotero doesn't show item keys in its normal interface.
These workarounds should work:

1. **Storage folder name (easiest):** right-click the attachment →
   *Show File*. For files stored in Zotero storage, the folder is named after
   the attachment key: `~/Zotero/storage/7XK2Q9PM/Smith_2020.pdf`. This
   doesn't work for linked files, which stay wherever you put them.
2. **Note from annotations:** in the reader, *Add Note from Annotations*, or
   drag an annotation into a note. The note contains
   `zotero://open-pdf/library/items/<attachmentKey>?…` links. You can see them
   by copying the note or exporting it to Markdown.
3. **Run JavaScript:** select the attachment, open
   *Tools → Developer → Run JavaScript*, and run
   `return ZoteroPane.getSelectedItems()[0].key`.
4. **zotero.org web library**, if you sync: the URL contains the key when you
   open the attachment.

### Finding it from this plugin (easier)

You never need to copy it by hand. During import, the plugin gets it from
Better BibTeX for every attachment. In templates, each attachment has:

- `attachment.itemKey`: the attachment key
- `attachment.pdfURI`: the full `zotero://open-pdf/…` link built from it, set
  for PDFs only

The plugin's **Data explorer** command shows these fields for any item you
pick, so you can check them there. That's why Option A (section 5) only needs a
template change.

## 1. Zotero's `zotero://` URL handlers (from the Zotero source)

Handlers are registered in `chrome/content/zotero/ZoteroProtocolHandler.mjs`
(Zotero `main`):

```js
this._extensions["zotero://select"]   = SelectExtension;
this._extensions["zotero://open"]     = OpenExtension;
this._extensions["zotero://open-pdf"] = OpenExtension;   // same handler, legacy name
```

### `zotero://open-pdf/…` / `zotero://open/…` opens the reader

Accepted paths:

```
zotero://open-pdf/library/items/<attachmentKey>
zotero://open-pdf/groups/<groupID>/items/<attachmentKey>
zotero://open-pdf/<libraryID>_<attachmentKey>/<page>        (legacy ZotFile form)
```

Query parameters, mapped to the reader `location`:

| Param | Effect |
| --- | --- |
| `page=N` | PDF page, 1-based (`pageIndex = N - 1`) |
| `annotation=<annotationKey>` | scroll to and select that annotation |
| `cfi=<urlencoded EPUB CFI>` | EPUB position |
| `sel=<urlencoded CSS selector>` | snapshot (HTML) position |

What the handler does:

```js
var item = results[0];
if (!item.isFileAttachment()) {
    Zotero.warn(`Item for ${uriPath} is not a file attachment`);
    return;                                   // <- parent items are rejected
}
...
await Zotero.FileHandlers.open(item, { location, openInWindow });
```

Consequences:

- The key **must be an attachment key**, not the parent item's key.
- The handler is not limited to PDFs. `Zotero.FileHandlers.open` opens EPUBs
  and HTML snapshots in Zotero's reader too. Other file types go to whatever
  file handler is set in Zotero's preferences.
- It respects Zotero's "open in new window" preference
  (`openReaderInNewWindow`).
- The `zotero://open` alias is in the current source. On older Zotero 7 builds,
  use `open-pdf`, which is the same handler and works everywhere.

### `zotero://select/…` selects in the library pane

```
zotero://select/library/items/<itemKey>
zotero://select/groups/<groupID>/items/<itemKey>
```

This selects the item in the main window. It never opens the reader.

## 2. What Better BibTeX adds (from the BBT source)

### 2a. `@citekey` inside `zotero://` URLs

`content/better-bibtex.ts` monkey-patches `Zotero.API.getResultsFromParams`
(and `parseLibraryKeyHash`) so that an object key of the form `@citekey` or
`bbt:citekey` is replaced with the item key that has that citekey:

```ts
function ck(key: string): string {
  const m = key.match(/^(bbt:|@)(.+)/)
  if (!m) return key
  const citekey = Zotero.BetterBibTeX.KeyManager.any(_ => _.libraryID === libraryID && _.citationKey === m[2])
  return citekey ? citekey.itemKey : key
}
```

Both `select` and `open-pdf` go through `getResultsFromParams`, so:

| URL | Result |
| --- | --- |
| `zotero://select/library/items/@smith2020` | ✅ selects the item |
| `zotero://select/groups/<id>/items/@smith2020` | ✅ (lookup runs in that group library) |
| `zotero://open-pdf/library/items/@smith2020` | ❌ resolves to the **parent** item, then fails with "not a file attachment". Nothing opens. |

BBT can put the select form on the clipboard: Quick Copy format
"Zotero select link" (Zotero Settings → Export → Item Format → *Better BibTeX
Quick Copy: …*). There is an open BBT feature request (#2214) for citekey-based
`open-pdf` links, because the citekey has no way to pick one of several
attachments.

### 2b. JSON-RPC: `item.attachments`, the citekey → reader-link resolver

`POST http://127.0.0.1:23119/better-bibtex/json-rpc`

```json
{ "jsonrpc": "2.0", "method": "item.attachments", "params": ["smith2020", "*"] }
```

(`library` = a libraryID, or `"*"` for the personal library plus all groups.)
From `content/json-rpc.ts`, each attachment comes back as:

```ts
{
  open: `zotero://open-pdf/${Zotero.API.getLibraryPrefix(libraryID)}/items/${att.key}`,
  path: att.getFilePath(),
  annotations?: [...]          // native Zotero annotations, file attachments only
}
```

`open` is exactly the reader link you need: the attachment key plus the right
`library/` or `groups/<id>/` prefix. This plugin already calls this method
(`src/bbt/jsonRPC.ts:117`, `getAttachmentsFromCiteKey`), but it uses only
`annotations` and `path` and throws `open` away.

### 2c. JSON-RPC: `viewer.viewPDF`, which opens directly

```json
{ "jsonrpc": "2.0", "method": "viewer.viewPDF",
  "params": ["http://zotero.org/users/12345678/items/ABCD1234", 0] }
```

This takes the **item URI**, not a citekey. It picks the parent's best PDF
attachment and calls `Zotero.OpenPDF.openToPage(att, page + 1)`. The page is
zero-based. It handles **PDFs only**, not EPUB or snapshots. The URI is in
every BBT JSON item export as `item.uri`, so the plugin already has it at
import time. A citekey needs two calls: resolve it to a URI first (for example
with `item.export` or `item.search`).

### 2d. CAYW `select=true`

`/better-bibtex/cayw?select=true` selects the picked items in Zotero. This is
interactive (it opens the picker), so it is not useful here.

## 3. What does *not* work

- **Zotero Web API** (api.zotero.org): cloud data only, no control over the
  desktop app.
- **Zotero 7 local API** (`http://localhost:23119/api/…`, enable under
  Settings → Advanced): a read-only mirror of the Web API. It can return
  attachment keys (`/api/users/0/items/<key>/children`), which you could then
  put into `zotero://open-pdf/…`, but it has no "open" endpoint. BBT's
  `item.attachments` does the same in one call and also accepts citekeys.
- **Running arbitrary JS** inside Zotero, e.g. with BBT's test-only
  `debug-bridge` add-on (`/debug-bridge/execute`, then
  `Zotero.Reader.open(itemID, location)`): technically possible, but its own
  author calls it a major security risk. It is not needed, because the URL
  scheme covers this use case.

## 4. What this plugin already produces (repo analysis)

Relevant code:

| Location | What it does |
| --- | --- |
| `src/bbt/helpers.ts:147` `getLocalURI(ext, uri, params)` | Turns `http://zotero.org/{users/N|groups/N}/items/KEY` into `zotero://select/…` or `zotero://open-pdf/…`, with optional query params |
| `src/bbt/export.ts:68` `processAttachment` | For each attachment: `attachment.itemKey`, `attachment.desktopURI` (= **select** link), and, **only for `*.pdf`**, `attachment.pdfURI` (= **open-pdf** link, i.e. the reader link) |
| `src/bbt/export.ts:106`, `:132` | Every annotation gets `annotation.desktopURI` = `open-pdf` link with `page` (and `annotation` for native ones) |
| `src/bbt/export.ts:279` | `item.desktopURI` = item **select** link |
| `src/bbt/basicTemplates/applyBasicTemplates.ts` | Basic-template vars `pdfLink` / `firstAttachmentLink` (`file://` links that open the PDF in the OS default app, **not** Zotero) and `pdfZoteroLink` / `firstAttachmentZoteroLink` |

Things to watch out for:

1. **`pdfZoteroLink` / `firstAttachmentZoteroLink` use `file.desktopURI`,
   which is the *select* link**, not the reader link
   (`applyBasicTemplates.ts:27-52`). Clicking them highlights the attachment
   in the library but does not open it. The reader link is
   `file.pdfURI`.
2. `pdfURI` is only set when `path` ends with `.pdf`. For EPUB and snapshot
   attachments you have to build it yourself, for example:
   `{{ file.desktopURI | replace("zotero://select", "zotero://open-pdf") }}`.
   This works because the path structure is the same and `open-pdf` handles
   all file attachments.
3. Small bug: `export.ts:280` calls `getLocalURI('select', item.uri, item.itemKey)`.
   It passes a string where a params object is expected, so the fallback URL
   would get a junk query (`?ABCD1234=`). This rarely matters, because BBT
   JSON already contains `item.select`, which takes precedence.

## 5. Recommended ways to do it

### Option A: store the reader link at import (no code change)

Add the link to the **import template** (Settings → Import formats → template
file). Put it in frontmatter so Canvas/Bases/Dataview can use it, and as a
clickable link in the body:

```nunjucks
---
citekey: {{citekey}}
zotero-select: {{desktopURI}}
{%- set pdf = attachments | filterby("path", "endswith", ".pdf") | first %}
{%- if pdf %}
zotero-reader: {{pdf.pdfURI}}
{%- endif %}
---

{% if pdf %}[📖 Open in Zotero reader]({{pdf.pdfURI}}){% endif %} · [Show in Zotero]({{desktopURI}})

{# all readable attachments (PDF, EPUB, snapshot) #}
{% for a in attachments %}{% if a.path %}
- [{{a.title}}]({{ a.desktopURI | replace("zotero://select", "zotero://open-pdf") }})
{% endif %}{% endfor %}
```

The note links look like this (example output):

```
zotero://open-pdf/library/items/7XK2Q9PM
zotero://open-pdf/groups/4711/items/7XK2Q9PM?page=12
```

**Using it in Obsidian:**

- **Markdown:** clicking `[text](zotero://open-pdf/…)` opens Zotero's reader.
  Obsidian passes unknown URL schemes to the OS (users report this working on
  desktop and mobile).
- **Canvas:** add the literature notes as **file cards**, or add **text
  cards** that contain the Markdown link. The rendered link is clickable inside
  the card. Do **not** use *link (web embed)* cards: they try to load the URL
  in an iframe, which can't render a `zotero://` URL.
- **Bases / Dataview tables:** a `zotero-reader` property that holds a URL can
  be shown as a clickable link column.

Pros: no code changes, works offline from the note itself, and the link is
fast (no API call).
Cons: the attachment key is fixed at import time. It goes stale if the PDF is
replaced or deleted in Zotero; re-import the note to refresh it. The link
opens the **first** PDF only, unless you list them all as shown above.

### Option A in detail: links to annotations (notes inside the PDF)

Only **Option A** stores links at import time. Options B and C look the
attachment up when you click. Variant A3 below mixes the two.

#### Three kinds of "notes inside the PDF"

| Kind | Where it lives | Link the plugin writes at import | What clicking it does |
| --- | --- | --- | --- |
| **Native Zotero annotations** (made in Zotero's reader; `annotation.source == "zotero"`) | Zotero database, with their own annotation key (`annotation.id`) | `annotation.desktopURI` = `open-pdf/…/<attachmentKey>?page=<pageLabel>&annotation=<annotationKey>` (`src/bbt/export.ts:132`) | Opens the reader and should jump to and select that annotation |
| **Annotations embedded in the PDF file** (Acrobat, Preview, etc., read by `pdfannots2json`; `annotation.source == "pdf"`) | Inside the PDF file; no Zotero key | `annotation.desktopURI` = `open-pdf/…/<attachmentKey>?page=<pageLabel>` (`export.ts:106`) | Opens the reader **at the page only**. Zotero has no ID to jump to the annotation itself |
| **Zotero notes made from annotations** (rendered in `markdownNotes`) | Note HTML with `data-annotation` references | "Go to annotation" links with `page` and `annotation` added (`src/bbt/exportNotes.ts:87`) | Same as native annotations |

#### Problems in the plugin's own links

1. **Page label passed as the page number.** All three link builders put
   `pageLabel` (the page number printed on the page, e.g. `245` or `iv`) into
   `?page=`. Zotero reads `page` as the physical page number
   (`pageIndex = parseInt(page) - 1`). For journal articles with printed page
   numbers, or for roman numerals, that is the wrong page or `NaN`.
   - Native annotations are probably fine, because the `annotation=` key
     should take priority. I haven't checked how Zotero resolves a page and an
     annotation key that conflict.
   - **PDF-embedded annotations are affected**, because the page is all they
     have. Use the physical page `annotation.page` instead. First check in the
     Data explorer that `annotation.page` exists for `pdfannots2json`
     annotations.
2. **First-page annotations lose their page.** `annot.page` is only set
   `if (annotationPosition.pageIndex)`, so annotations on page 1 (index 0) get
   no `page` value (`export.ts:139`).
3. **No links for EPUB or snapshot annotations.** Native annotations only get
   a `desktopURI` when the attachment is a `.pdf`. Zotero itself can jump to an
   annotation in any of its reader formats, so you can build the link in the
   template:
   `{{ annotation.attachment.desktopURI | replace("zotero://select", "zotero://open-pdf") }}?annotation={{annotation.id}}`
4. The plugin's own basic template has the same page-label problem
   (`applyBasicTemplates.ts:62`), and so do the "Go to annotation" links in
   imported Zotero notes (`exportNotes.ts:88`).

#### Three ways to store links at import time

| Variant | What you do | Links to annotations | When links go stale |
| --- | --- | --- | --- |
| **A1. Template only** | Use `pdfURI` for the item, and per annotation build the link from `annotation.attachment` + `annotation.page` + `annotation.id` (native) or + `annotation.page` (embedded), plus the EPUB/snapshot workaround above | Native: jumps to the annotation. Embedded: page only | The attachment is deleted or replaced. Embedded-annotation pages also break if the PDF file is swapped |
| **A2. Fix the plugin code** | In `export.ts`, build a reader link for **every** file attachment (not only `.pdf`), use the physical page instead of the page label, and fix the page-1 case. Fix the same in `exportNotes.ts` and the basic template | Same as A1, but correct out of the box for every template | Same as A1 |
| **A3. Store IDs, resolve when clicked** | At import, write `obsidian://zotero-reader?citekey=…&annotation=<annotationKey>` (or `&page=N` for embedded annotations). The handler from Option B calls `item.attachments(citekey)` and picks the attachment whose `annotations` contain that key | Same jump targets | Doesn't break when a PDF is replaced or the citekey's attachments change. Needs the Option B code, and Zotero must be running |

**Recommendation:** start with **A1**; it's a template change only. Do
**A2** if you want the page-number and EPUB problems fixed for everyone using
the plugin. Move to **A3** if your Canvas files need to outlive PDF
replacements.

#### A1 applied: `_custom/template.md`

The personal import template now stores everything A1 needs:

| Where | What it adds |
| --- | --- |
| Frontmatter | `zotero-select`: item select link. `zotero-reader`: reader link to the first PDF, or to the first attachment with a file if there is no PDF (EPUB, snapshot). Properties are meant for Bases/Dataview/Canvas lookups |
| `[!LINK]` callout | "Show in Zotero" link for the item. For **every** attachment with a file (no longer only PDFs): the existing `file://` link plus "Open in Zotero reader" |
| Annotations | A `> [p. <label>](…)` link under each annotation. Native: `?page=<physical page>&annotation=<key>` (EPUB/snapshot: `?annotation=<key>` only). Embedded: `?page=<physical page>`. The visible text still shows the printed page label |

How the reader link is built in the template (handles PDF, EPUB and snapshot):

```nunjucks
{{ att.pdfURI or (att.desktopURI | replace("zotero://select", "zotero://open-pdf")) }}
```

Caveats for this template:

- **Existing notes don't get the new annotation links automatically.** The
  annotations section is inside `{% persist "annotations" %}`, and only
  annotations newer than the last import are rendered. Already imported
  annotations stay as they are. To add links to old annotations, delete the
  content between `%% begin annotations %%` and `%% end annotations %%` and
  re-import. Manual edits in that block are lost. The frontmatter and
  `[!LINK]` callout are regenerated on every import, so they update at once.
- The top-level `annotations` variable holds the annotations of the **first
  attachment that has any** (`getTemplateData`, `export.ts:582`). Annotations
  on a second PDF of the same item are not shown. Looping over
  `attachments` → `attachment.annotations` would include them.
- Note annotations (`type == "text"`) have their text in `a.comment`, not in
  `a.annotatedText`. The template doesn't render `a.comment`, so a note
  annotation shows up as an empty quote with only the link. Add
  `{{a.comment}}` if you want its content.
- I haven't test-rendered this template (no Node.js in this environment).
  Check the result on one item with the **Data explorer** first, or by
  importing a test item.

### Option B: resolve at click time from the citekey (small plugin feature)

This is useful when the Canvas/Markdown contains only `@citekey` references,
or note files named by citekey, without a stored key. Add a command (or an
`obsidian://` protocol action) that:

1. gets the citekey (frontmatter `citekey` of the active file, the selected
   Canvas card's file, the word under the cursor, or a URL parameter),
2. calls `item.attachments(citekey, "*")` through the existing
   `getAttachmentsFromCiteKey`,
3. picks the preferred attachment (first `.pdf`, otherwise `.epub` or
   `.html`),
4. opens its `open` URL with `window.open(url)` (Electron passes it to the
   OS, which hands it to Zotero), optionally with `?page=N`.

Sketch for `src/main.ts`:

```ts
import { getAttachmentsFromCiteKey } from './bbt/jsonRPC';

async openInZoteroReader(citekey: string, page?: number) {
  const database = { database: this.settings.database, port: this.settings.port };
  const atts: { open: string; path?: string }[] | null =
    await getAttachmentsFromCiteKey({ key: citekey.replace(/^@/, ''), library: '*' as any }, database);
  if (!atts?.length) return new Notice(`No attachments for ${citekey}`);

  const pick =
    atts.find((a) => a.path?.toLowerCase().endsWith('.pdf')) ??
    atts.find((a) => /\.(epub|html?)$/i.test(a.path ?? '')) ??
    atts[0];

  window.open(page ? `${pick.open}?page=${page}` : pick.open);
}

// in onload():
this.addCommand({
  id: 'zdc-open-in-zotero-reader',
  name: 'Open current note’s item in Zotero reader',
  callback: () => {
    const file = this.app.workspace.getActiveFile();
    const ck = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.citekey;
    if (ck) this.openInZoteroReader(String(ck));
    else new Notice('No citekey in frontmatter');
  },
});

// clickable from anywhere, e.g. in a Canvas text card:
//   [📖](obsidian://zotero-reader?citekey=smith2020&page=3)
this.registerObsidianProtocolHandler('zotero-reader', (p) =>
  this.openInZoteroReader(p.citekey, p.page ? Number(p.page) : undefined));
```

Notes:

- `getAttachmentsFromCiteKey` is typed for `library: number`. BBT also accepts
  `"*"`, which searches all libraries; otherwise pass the real library ID. The
  function also opens a "Fetching…" modal and fetches annotation data. A slim
  variant without either would be faster.
- `obsidian://zotero-reader?citekey=…` links are stable: they survive PDF
  replacement and Zotero re-syncs, because they are resolved every time. They
  need Zotero and BBT to be running, as every link here does.
- `viewer.viewPDF(item.uri, page)` is an alternative for step 2–4, but it
  needs the item URI and supports PDFs only. `item.attachments` is the better
  choice.

### Option C: no Obsidian code, an external script

The same JSON-RPC call works from any tool (shell, Alfred, Raycast, Keyboard
Maestro). Obsidian can trigger it through the Shell Commands plugin. Example
(macOS):

```sh
ck="smith2020"
url=$(curl -s http://127.0.0.1:23119/better-bibtex/json-rpc \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"item.attachments\",\"params\":[\"$ck\",\"*\"]}" \
  | jq -r '[.result[] | select(.path|test("\\.pdf$";"i"))][0].open')
open "$url"
```

### Recommendation

Use **Option A** right away: one template change, and every imported note and
Canvas card gets a working "open in Zotero reader" link. Add **Option B**
(command plus `obsidian://zotero-reader?citekey=` handler) if you want
citekey-only references that never go stale, or a hotkey that works from the
active note or Canvas selection.

## Prerequisites and caveats

- Zotero 7 desktop must be running, with Better BibTeX installed (BBT is
  required for the citekey lookup; `zotero://open-pdf/<attachmentKey>` links
  work without BBT).
- Citekeys must be stable: pin them in BBT, or don't change the citekey
  formula. A changed citekey breaks Option B lookups, not Option A links.
- For group libraries, the link must contain `groups/<groupID>`.
  `getLocalURI` and BBT's `open` field already do this.
- Linked files (not stored in Zotero storage) work as long as the path exists.
  Missing files fail without a message (Zotero only logs a warning).

## Sources

- Zotero protocol handler source: <https://github.com/zotero/zotero/blob/main/chrome/content/zotero/ZoteroProtocolHandler.mjs>
- BBT JSON-RPC source (`item.attachments`, `viewer.viewPDF`): <https://github.com/retorquere/zotero-better-bibtex/blob/master/content/json-rpc.ts>
- BBT `@citekey` URL patch: <https://github.com/retorquere/zotero-better-bibtex/blob/master/content/better-bibtex.ts>
- BBT JSON-RPC docs: <https://retorque.re/zotero-better-bibtex/exporting/json-rpc/>
- BBT citing / CAYW docs: <https://retorque.re/zotero-better-bibtex/citing/>, <https://retorque.re/zotero-better-bibtex/citing/cayw/>
- BBT issue #2214, citekey-based open-pdf links: <https://github.com/retorquere/zotero-better-bibtex/issues/2214>
- BBT issue #769, `bbt:`/`@` select links: <https://github.com/retorquere/zotero-better-bibtex/issues/769>
- Forum, citekey select links are a BBT feature: <https://forums.zotero.org/discussion/comment/414431>
- Forum, `open` field of `item.attachments` used to open PDFs: <https://forums.zotero.org/discussion/comment/364621>
- Forum, open-pdf URL format, page/annotation params: <https://forums.zotero.org/discussion/comment/424783/>, <https://forums.zotero.org/discussion/comment/456735/>
- Forum, rename open-pdf → open (alias kept): <https://forums.zotero.org/discussion/107371/>
- Zotero local API: <https://www.zotero.org/support/dev/web_api/v3/local_api>
- debug-bridge (security caveat): <https://forums.zotero.org/discussion/75569/>
- Obsidian "Zotero Cite Links" plugin (same idea, third party): <https://community.obsidian.md/plugins/zotero-cite-links>
