# How the plugin talks to Zotero

How this Obsidian plugin (v3.2.1) reaches the Zotero library, how it finds it,
and how it reads annotations and notes from PDFs.

## TL;DR

| Question | Answer |
| --- | --- |
| **Technology** | HTTP to the local web server that the **Better BibTeX (BBT)** add-on runs inside the Zotero desktop app. The plugin calls BBT's **JSON-RPC 2.0** endpoint and its **CAYW** ("Cite As You Write") endpoint. |
| **Location** | No file lookup. It is a fixed loopback address, `http://127.0.0.1:<port>`, and the port depends on the selected "database": Zotero `23119`, Juris-M `24119`, Custom = user-defined (default `23119`). |
| **PDF annotations** | Two sources are merged: (1) **native Zotero annotations** made in Zotero's built-in PDF reader, read from the BBT JSON-RPC method `item.attachments`; (2) **annotations embedded in the PDF file** itself, read by running a bundled native binary, **`pdfannots2json`**, on the PDF's local file path. |
| **Zotero notes** | Note HTML is fetched through BBT (`item.notes`, or the `notes` field in item exports). It is parsed with `DOMParser`, the `data-annotation` / `data-citation` elements are resolved, and the result is converted to Markdown with Obsidian's `htmlToMarkdown`. |

The plugin **never** reads `zotero.sqlite` and **never** uses the zotero.org
Web API. Everything goes through the running desktop app. Zotero must be open
and BBT must be installed. Because of this, and because it spawns a native
binary, the plugin is desktop-only (`"isDesktopOnly": true` in `manifest.json`).

---

## 1. Access technology: Better BibTeX's local HTTP server

Zotero desktop runs a small HTTP server on localhost (its "connector" server).
Better BibTeX adds its own routes to that server under `/better-bibtex/…`. The
plugin only uses those BBT routes.

All requests go through Obsidian's `request()` API (from the `obsidian`
package) with the headers in `src/bbt/helpers.ts:4`:

```ts
{ 'Content-Type': 'application/json', 'User-Agent': 'obsidian/zotero',
  Accept: 'application/json', Connection: 'keep-alive' }
```

### Endpoints used

| Endpoint | Method | Used for | Code |
| --- | --- | --- | --- |
| `/better-bibtex/cayw?probe=true` | GET | Health check. Returns `ready` when Zotero and BBT are up. The result is cached for 30 s. | `src/bbt/cayw.ts:22` `isZoteroRunning` |
| `/better-bibtex/cayw?format=…` | GET | Opens Zotero's citation picker and returns the formatted citation (pandoc, latex, biblatex, formatted-citation). | `src/bbt/cayw.ts:81` `getCAYW` |
| `/better-bibtex/cayw?format=translate&translator=36a3b0b5-…&exportNotes=false` | GET | Opens the picker and returns the selected items as BBT JSON. Citekeys and library IDs are taken from this. | `src/bbt/cayw.ts:154` `getCAYWJSON` |
| `/better-bibtex/json-rpc` | POST | All other data access (see the next table). | `src/bbt/jsonRPC.ts` |
| `/better-bibtex/export/library?/<groupId>/<groupName>.<translatorId>` | GET | Exports a whole library as CSL-JSON to build the citekey list for autocomplete. | `src/bbt/jsonRPC.ts:567` `getCiteKeyExport` |

### JSON-RPC methods called (`POST /better-bibtex/json-rpc`)

| RPC method | Purpose | Function |
| --- | --- | --- |
| `item.export` (translator `36a3b0b5-bad0-4a04-b79b-441c7cef77db` = *Better BibTeX JSON*) | Full item metadata, including `attachments` (with local `path`), `notes`, `relations`, etc. | `getItemJSONFromCiteKeys` (`jsonRPC.ts:310`) |
| `item.export` (translator `f4b52ab0-f878-4556-85a0-c7aeedd09dfc` = *CSL JSON*) | Issued date | `getIssueDateFromCiteKey` (`jsonRPC.ts:454`) |
| `item.attachments` | Attachment details, **including native Zotero annotations** | `getAttachmentsFromCiteKey` (`jsonRPC.ts:117`) |
| `item.notes` | Child notes (HTML) | `getNotesFromCiteKeys` (`jsonRPC.ts:10`) |
| `item.collections` | Collection hierarchy | `getCollectionFromCiteKey` (`jsonRPC.ts:55`) |
| `item.bibliography` | Formatted bibliography (HTML, converted to Markdown) | `getBibFromCiteKeys` (`jsonRPC.ts:236`) |
| `item.citationkey` | Resolves related-item URIs to citekeys | `getItemJSONFromRelations` (`jsonRPC.ts:367`) |
| `item.search` | Search by term | `execSearch` (`jsonRPC.ts:531`) |
| `user.groups` | Lists the user's and group libraries (id and name) | `getUserGroups` (`jsonRPC.ts:616`), `getLibForCiteKey` |

Items are always addressed by **citation key + library ID** (`CiteKey`
interface, `src/bbt/cayw.ts:125`), never by Zotero's internal item ID.

### Request serialisation

Every request is wrapped in `ZQueue.wait(qid)` / `ZQueue.end(qid)`.
`ZQueue` is a priority queue with **`maxConcurrent = 1`**
(`src/bbt/queue.ts`, last line), so only one request is sent to Zotero at a
time.

## 2. How the library is located

There is no discovery step. The Zotero data directory is not searched for,
and no profile or config files are read. The plugin assumes the server is on
loopback and only chooses the port (`src/bbt/helpers.ts:11`):

```ts
export function getPort(database: Database, port?: string) {
  if (database === 'Zotero') return '23119';   // Zotero default connector port
  if (database === 'Juris-M') return '24119';  // Juris-M default port
  if (!port) return '23119';
  return port;                                  // 'Custom' -> user setting
}
```

`Database` is `'Zotero' | 'Juris-M' | 'Custom'` (`src/types.ts:18`), set in the
plugin settings (`settings.database`, `settings.port`). Each call builds
`http://127.0.0.1:${getPort(...)}/better-bibtex/...`.

**Which library?** Zotero can hold the personal library and several group
libraries:

- In the interactive flow, the library ID comes from the items the user picks
  in the CAYW dialog (`libraryID` on each item). `exportToMarkdown` uses the
  library of the first selected item (`export.ts:594`, `citeKeys[0].library`).
- For autocomplete, `getAllCiteKeys` (`jsonRPC.ts:652`) calls `user.groups` and
  then exports each library with `/better-bibtex/export/library`. The result
  is cached for 60 s.

**Where the PDF files are:** BBT's item export returns each attachment with
its absolute **local file `path`**, i.e. the location in Zotero storage or the
linked-file path. The plugin uses that path directly in the filesystem. It
never works out Zotero's storage directory by itself.

## 3. How PDF annotations and notes are read

The main driver is `exportToMarkdown` (`src/bbt/export.ts:594`). The Data
Explorer (`dataExplorerPrompt`, `export.ts:887`) follows the same steps but
does not write any files.

```
CAYW picker ──► citekeys ──► item.export (BBT JSON) ──► items[].attachments[].path
                                                     └─► items[].notes (HTML)
for each attachment:
  ├─ (A) item.attachments ──► native Zotero annotations ──► convertNativeAnnotation()
  └─ (B) if *.pdf and binary present:
         execa(pdfannots2json, [path, flags…]) ──► JSON ──► processAnnotation()
  merge A + B (optional concat) ──► attachment.annotations ──► Nunjucks template ──► .md
```

### (A) Native Zotero annotations (made in Zotero's PDF/EPUB/snapshot reader)

Zotero 6+ stores highlights made in its own reader in its database, **not**
in the PDF file. They are fetched with the `item.attachments` RPC
(`getAttachmentData`, `export.ts:550`). The result is keyed by attachment
`path`, and each attachment's `annotations` array is mapped through
`convertNativeAnnotation` (`export.ts:112`):

- `annotationType`, `annotationColor` become `type`, `color`, and
  `colorCategory` (hex → HSL bucket, `bbt/helpers.ts:86`)
- `annotationText` / `annotationComment` become `annotatedText` / `comment`
- `annotationPageLabel` and `annotationPosition.pageIndex` / `rects` become
  `pageLabel`, `page`, `x`, `y`
- `annotationImagePath` (image or area annotations, which Zotero caches as
  PNGs in its cache directory) is **copied with `fs.copyFileSync` into the
  vault** at the configured image output path
- tags become `tags`, `allTags`, `hashTags`
- a `desktopURI` deep link of the form
  `zotero://open-pdf/library/items/<key>?page=…&annotation=…` is added
  (`getLocalURI`, `bbt/helpers.ts:147`)
- `source: 'zotero'`

### (B) Annotations embedded in the PDF file: `pdfannots2json`

Highlights and comments written into the PDF itself (by Acrobat, Preview,
ZotFile, etc.) are read by **`pdfannots2json`**, a separate native CLI from
<https://github.com/mgmeyers/pdfannots2json>.

- **Install:** the settings page downloads a platform-specific release
  (`v1.0.15`) from GitHub and extracts it into
  `<vault>/.obsidian/plugins/obsidian-zotero-desktop-connector/`
  (`src/settings/AssetDownloader.tsx`, `downloadAndExtract`).
- **Binary name:** `pdfannots2json.exe` on Windows, otherwise
  `pdfannots2json-<platform>-<arch>` (`src/helpers.ts:26`). The user can
  point to a different binary with the `exeOverridePath` setting.
- **Invocation:** `extractAnnotations` (`src/bbt/extractAnnotations.ts:36`)
  runs the binary with **`execa`** (a Node child-process wrapper). The first
  argument is the PDF path, followed by flags built from the settings:

  | Flag | Meaning |
  | --- | --- |
  | `-w` | no-write (Data Explorer preview only) |
  | `-o` / `-n` | image output dir / base name |
  | `-f` / `-d` / `-q` | image format / DPI / quality |
  | `-b` | ignore annotations before a date |
  | `-e` / `-l` | attempt OCR / OCR language |
  | `--tesseract-path` / `--tess-data-dir` | Tesseract location |

- **Output:** the binary prints a JSON array of annotations to stdout. Area
  annotations are rendered to image files directly in the vault. The plugin
  runs `JSON.parse` on stdout and passes each entry through
  `processAnnotation` (`export.ts:88`), which adds the date, attachment, image
  paths, an `open-pdf` deep link, and `source: 'pdf'`.
- **Errors:** password-protected PDFs and Type3-font errors return `[]` and
  show a Notice. Any other stderr output (except warnings) is reported as an
  error.

Annotations from (A) and (B) are combined into `attachment.annotations`. If
`settings.shouldConcat` is on, `concatAnnotations` (`export.ts:209`) merges
any annotation whose comment starts with `+` into the previous one.

### (C) Zotero notes (child notes and "notes from annotations")

Zotero notes are HTML. They arrive in the item export's `notes` array (and
through `item.notes` for the separate "Import notes" command,
`exportNotes.ts:134`). `processNote` (`export.ts:40`) calls
`processZoteroAnnotationNotes` (`src/bbt/exportNotes.ts:20`), which:

1. parses the HTML with the browser `DOMParser`,
2. finds the `[data-annotation]` elements. These are the annotation
   references Zotero adds when you create a note from annotations. Their
   attribute holds URI-encoded JSON with the `annotationKey`. A
   *"Go to annotation"* link (`zotero://open-pdf/…?page=…&annotation=…`) is
   added next to each one. For image annotations, the cached image is copied
   into the vault and the `<img src>` is rewritten,
3. turns each `[data-citation]` span into a `zotero://select/…` link to the
   cited item,
4. converts the resulting HTML to Markdown with Obsidian's `htmlToMarkdown`.

All the gathered data (item metadata, annotations, notes, collections,
bibliography, relations) is then rendered into Markdown with **Nunjucks**
templates (`src/bbt/template.env.ts`) and written with `app.vault.create` /
`app.vault.modify`.

## Prerequisites for the user

1. The Zotero (or Juris-M) desktop app must be **running**.
2. The **Better BibTeX** add-on must be installed. Without it, none of the
   `/better-bibtex/*` routes exist and the probe fails with
   *"Cannot connect to Zotero…"*.
3. Optional: the `pdfannots2json` binary must be downloaded from the plugin
   settings to import annotations embedded in PDF files. Native Zotero
   annotations work without it.
