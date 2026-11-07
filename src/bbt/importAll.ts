import { LoadingModal } from './LoadingModal';
import { CiteKey, isZoteroRunning } from './cayw';
import { exportToMarkdown } from './export';
import { getCiteKeyExport, getUserGroups } from './jsonRPC';
import { DatabaseWithPort, ExportToMarkdownParams } from '../types';

/**
 * "Import all items": imports every item of every Zotero library (personal +
 * groups) with one import format, without the CAYW picker.
 *
 * Folder placement (e.g. one subfolder per collection) is NOT handled here; it
 * comes from the import format's output path template, which has access to
 * `collections[].fullPath`. See _custom/README-import-all.md.
 *
 * Designed as the building block for a later scheduled / incremental sync:
 * listing and importing are separate steps, progress and cancellation are
 * injected, and the function never opens a modal itself.
 */

export interface LibraryCiteKeys {
  libraryID: number;
  name: string;
  citeKeys: CiteKey[];
}

export interface ImportAllProgress {
  library: string;
  libraryIndex: number;
  libraryCount: number;
  done: number;
  total: number;
}

export interface ImportAllOptions {
  /** Items per request to Zotero. Default 50. */
  batchSize?: number;
  /** Hide the per-request "Fetching…" modals. Default true. */
  suppressLoadingModals?: boolean;
  onProgress?: (p: ImportAllProgress) => void;
  /** Polled between batches; return true to stop. */
  isCancelled?: () => boolean;
}

export interface ImportAllResult {
  /** Items handed to the importer. */
  requested: number;
  /** Markdown files created or updated. */
  written: number;
  /** Citekeys that could not be imported (also after a one-by-one retry). */
  failed: string[];
  cancelled: boolean;
  /**
   * Set when the run was stopped because the first items all failed. This
   * usually means a template error or Zotero / Better BibTeX not answering.
   * It avoids one error notice per item for the whole library.
   */
  aborted: boolean;
  /** Citekeys that exist in more than one library (may map to the same file). */
  duplicateCiteKeys: string[];
}

/**
 * Lists the citekeys of all libraries. Returns null if Zotero / Better BibTeX
 * cannot be reached.
 *
 * Note: getCiteKeyExport skips entries without a citekey or without a title.
 */
export async function listAllLibraryCiteKeys(
  database: DatabaseWithPort
): Promise<LibraryCiteKeys[] | null> {
  if (!(await isZoteroRunning(database))) return null;

  const groups: { id: number; name: string }[] | null = await getUserGroups(
    database
  );
  if (!groups) return null;

  const out: LibraryCiteKeys[] = [];

  for (const group of groups) {
    const entries = await getCiteKeyExport(
      database,
      String(group.id),
      group.name
    );
    if (!entries) continue;

    out.push({
      libraryID: Number(group.id),
      name: group.name,
      citeKeys: entries.map((e) => ({ key: e.citekey, library: e.libraryID })),
    });
  }

  return out;
}

export function findDuplicateCiteKeys(libraries: LibraryCiteKeys[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();

  for (const lib of libraries) {
    for (const ck of lib.citeKeys) {
      if (seen.has(ck.key)) dupes.add(ck.key);
      seen.add(ck.key);
    }
  }

  return [...dupes];
}

async function importBatch(
  params: ExportToMarkdownParams,
  batch: CiteKey[]
): Promise<string[] | null> {
  try {
    // exportToMarkdown resolves item data with the library of the first
    // citekey, so a batch must never mix libraries (guaranteed by the caller).
    return await exportToMarkdown(params, batch);
  } catch (e) {
    console.error('Zotero Integration: import batch failed', e);
    return null;
  }
}

/** Stop if this many items failed before a single note was written. */
const ABORT_AFTER_INITIAL_FAILURES = 3;

export async function importAllItems(
  params: ExportToMarkdownParams,
  libraries: LibraryCiteKeys[],
  options: ImportAllOptions = {}
): Promise<ImportAllResult> {
  const batchSize = Math.max(1, options.batchSize ?? 50);
  const suppress = options.suppressLoadingModals ?? true;

  const result: ImportAllResult = {
    requested: 0,
    written: 0,
    failed: [],
    cancelled: false,
    aborted: false,
    duplicateCiteKeys: findDuplicateCiteKeys(libraries),
  };

  if (suppress) LoadingModal.suppress();

  try {
    for (let li = 0; li < libraries.length; li++) {
      const lib = libraries[li];
      const keys = lib.citeKeys;
      let i = 0;

      while (i < keys.length) {
        if (options.isCancelled?.()) {
          result.cancelled = true;
          return result;
        }

        // Import one item at a time until the first note has been written. A
        // broken template or an unreachable Zotero then shows a few error
        // notices (see ABORT_AFTER_INITIAL_FAILURES), not one per item of a
        // 50-item batch.
        const size = result.written === 0 ? 1 : batchSize;
        const batch = keys.slice(i, i + size);
        i += batch.length;
        result.requested += batch.length;

        const written = await importBatch(params, batch);

        if (written && written.length) {
          result.written += written.length;
        } else if (batch.length === 1) {
          result.failed.push(batch[0].key);
        } else {
          // A batch fails as a whole if Zotero rejects one item (or the request
          // times out). Retry item by item so one bad item does not drop the rest.
          for (const ck of batch) {
            if (options.isCancelled?.()) {
              result.cancelled = true;
              return result;
            }
            const single = await importBatch(params, [ck]);
            if (single && single.length) result.written += single.length;
            else result.failed.push(ck.key);
          }
        }

        if (
          result.written === 0 &&
          result.failed.length >= ABORT_AFTER_INITIAL_FAILURES
        ) {
          result.aborted = true;
          return result;
        }

        options.onProgress?.({
          library: lib.name,
          libraryIndex: li,
          libraryCount: libraries.length,
          done: i,
          total: keys.length,
        });
      }
    }
  } finally {
    if (suppress) LoadingModal.unsuppress();
  }

  return result;
}
