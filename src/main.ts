import Fuse from 'fuse.js';
import { EditableFileView, Events, Notice, Plugin, TFile } from 'obsidian';
import { shellPath } from 'shell-path';

import { DataExplorerView, viewType } from './DataExplorerView';
import { confirm, pickExportFormat } from './ImportAllModals';
import { LoadingModal } from './bbt/LoadingModal';
import { getCAYW } from './bbt/cayw';
import { exportToMarkdown, renderCiteTemplate } from './bbt/export';
import {
  filesFromNotes,
  insertNotesIntoCurrentDoc,
  noteExportPrompt,
} from './bbt/exportNotes';
import {
  ImportAllResult,
  LibraryCiteKeys,
  importAllItems,
  listAllLibraryCiteKeys,
} from './bbt/importAll';
import './bbt/template.helpers';
import {
  currentVersion,
  downloadAndExtract,
  internalVersion,
} from './settings/AssetDownloader';
import { ZoteroConnectorSettingsTab } from './settings/settings';
import {
  CitationFormat,
  CiteKeyExport,
  ExportFormat,
  ZoteroConnectorSettings,
} from './types';

const commandPrefix = 'obsidian-zotero-desktop-connector:';
const citationCommandIDPrefix = 'zdc-';
const exportCommandIDPrefix = 'zdc-exp-';
const DEFAULT_SETTINGS: ZoteroConnectorSettings = {
  database: 'Zotero',
  noteImportFolder: '',
  pdfExportImageDPI: 120,
  pdfExportImageFormat: 'jpg',
  pdfExportImageQuality: 90,
  citeFormats: [],
  exportFormats: [],
  citeSuggestTemplate: '[[{{citekey}}]]',
  openNoteAfterImport: false,
  whichNotesToOpenAfterImport: 'first-imported-note',
  confirmImportAll: true,
};

async function fixPath() {
  if (process.platform === 'win32') {
    return;
  }

  try {
    const path = await shellPath();

    process.env.PATH =
      path ||
      [
        './node_modules/.bin',
        '/.nodebrew/current/bin',
        '/usr/local/bin',
        process.env.PATH,
      ].join(':');
  } catch (e) {
    console.error(e);
  }
}

export default class ZoteroConnector extends Plugin {
  settings: ZoteroConnectorSettings;
  emitter: Events;
  fuse: Fuse<CiteKeyExport>;
  private importAllRunning = false;
  private importAllCancelRequested = false;

  async onload() {
    await this.loadSettings();
    this.emitter = new Events();

    this.updatePDFUtility();
    this.addSettingTab(new ZoteroConnectorSettingsTab(this.app, this));
    this.registerView(viewType, (leaf) => new DataExplorerView(this, leaf));

    this.settings.citeFormats.forEach((f) => {
      this.addFormatCommand(f);
    });

    this.settings.exportFormats.forEach((f) => {
      this.addExportCommand(f);
    });

    this.addCommand({
      id: 'zdc-insert-notes',
      name: 'Insert notes into current document',
      editorCallback: (editor) => {
        const database = {
          database: this.settings.database,
          port: this.settings.port,
        };
        noteExportPrompt(
          database,
          this.app.workspace.getActiveFile()?.parent.path
        ).then((notes) => {
          if (notes) {
            insertNotesIntoCurrentDoc(editor, notes);
          }
        });
      },
    });

    this.addCommand({
      id: 'zdc-import-notes',
      name: 'Import notes',
      callback: () => {
        const database = {
          database: this.settings.database,
          port: this.settings.port,
        };
        noteExportPrompt(database, this.settings.noteImportFolder)
          .then((notes) => {
            if (notes) {
              return filesFromNotes(this.settings.noteImportFolder, notes);
            }
            return [] as string[];
          })
          .then((notes) => this.openNotes(notes));
      },
    });

    this.addCommand({
      id: 'zdc-import-all',
      name: 'Import all items (all libraries)',
      callback: () => this.importAllCommand(),
    });

    this.addCommand({
      id: 'show-zotero-debug-view',
      name: 'Data explorer',
      callback: () => {
        this.activateDataExplorer();
      },
    });

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          this.emitter.trigger('fileUpdated', file);
        }
      })
    );

    app.workspace.trigger('parse-style-settings');

    fixPath();
  }

  onunload() {
    this.settings.citeFormats.forEach((f) => {
      this.removeFormatCommand(f);
    });

    this.settings.exportFormats.forEach((f) => {
      this.removeExportCommand(f);
    });

    this.app.workspace.detachLeavesOfType(viewType);
  }

  addFormatCommand(format: CitationFormat) {
    this.addCommand({
      id: `${citationCommandIDPrefix}${format.name}`,
      name: format.name,
      editorCallback: (editor) => {
        const database = {
          database: this.settings.database,
          port: this.settings.port,
        };
        if (format.format === 'template' && format.template.trim()) {
          renderCiteTemplate({
            database,
            format,
          }).then((res) => {
            if (typeof res === 'string') {
              editor.replaceSelection(res);
            }
          });
        } else {
          getCAYW(format, database).then((res) => {
            if (typeof res === 'string') {
              editor.replaceSelection(res);
            }
          });
        }
      },
    });
  }

  removeFormatCommand(format: CitationFormat) {
    (this.app as any).commands.removeCommand(
      `${commandPrefix}${citationCommandIDPrefix}${format.name}`
    );
  }

  addExportCommand(format: ExportFormat) {
    this.addCommand({
      id: `${exportCommandIDPrefix}${format.name}`,
      name: format.name,
      callback: async () => {
        const database = {
          database: this.settings.database,
          port: this.settings.port,
        };
        this.openNotes(
          await exportToMarkdown({
            settings: this.settings,
            database,
            exportFormat: format,
          })
        );
      },
    });
  }

  removeExportCommand(format: ExportFormat) {
    (this.app as any).commands.removeCommand(
      `${commandPrefix}${exportCommandIDPrefix}${format.name}`
    );
  }

  /**
   * Interactive "Import all items": pick a format, confirm, run with a
   * progress notice. Running the command again while an import is in
   * progress offers to cancel it.
   */
  async importAllCommand() {
    if (this.importAllRunning) {
      const stop = await confirm(
        this.app,
        'Import all items is running',
        ['Stop after the current batch?'],
        'Stop import'
      );
      if (stop) this.importAllCancelRequested = true;
      return;
    }

    if (!this.settings.exportFormats.length) {
      new Notice('Zotero Integration: no import format configured.');
      return;
    }

    const format = await pickExportFormat(
      this.app,
      this.settings.exportFormats
    );
    if (!format) return;

    const database = {
      database: this.settings.database,
      port: this.settings.port,
    };
    const libraries = await listAllLibraryCiteKeys(database);
    if (!libraries) {
      new Notice('Zotero Integration: could not list the Zotero libraries.');
      return;
    }

    if (this.settings.confirmImportAll !== false) {
      const ok = await this.confirmImportAll(format.name, libraries);
      if (!ok) return;
    }

    await this.importAll(format.name, true, libraries);
  }

  private confirmImportAll(
    formatName: string,
    libraries: LibraryCiteKeys[]
  ): Promise<boolean> {
    const total = libraries.reduce((n, l) => n + l.citeKeys.length, 0);
    return confirm(
      this.app,
      'Import all Zotero items?',
      [
        `${total} items in ${libraries.length} ${
          libraries.length === 1 ? 'library' : 'libraries'
        } (${libraries
          .map((l) => `${l.name}: ${l.citeKeys.length}`)
          .join(', ')}) will be imported with the format "${formatName}".`,
        `Existing notes at the same paths are updated like a normal re-import ` +
          `(content outside persist blocks is regenerated).`,
        `This can take a while. Run the command again to stop the import.`,
      ],
      'Import all'
    );
  }

  /**
   * Imports every item of every library with the given import format, without
   * any Zotero picker. Usable from scripts:
   *   app.plugins.plugins['obsidian-zotero-desktop-connector'].importAll('My format')
   *
   * @param libraries  pre-fetched citekey lists (from listAllLibraryCiteKeys);
   *                   fetched here if omitted
   */
  async importAll(
    formatName: string,
    showProgress = true,
    libraries?: LibraryCiteKeys[]
  ): Promise<ImportAllResult | null> {
    const format = this.settings.exportFormats.find(
      (f) => f.name === formatName
    );
    if (!format) {
      throw new Error(`Error: Import format "${formatName}" not found`);
    }
    if (this.importAllRunning) {
      new Notice('Zotero Integration: an import-all is already running.');
      return null;
    }

    const database = {
      database: this.settings.database,
      port: this.settings.port,
    };

    this.importAllRunning = true;
    this.importAllCancelRequested = false;
    const notice = showProgress
      ? new Notice('Zotero Integration: listing Zotero items…', 0)
      : null;

    try {
      const libs = libraries ?? (await listAllLibraryCiteKeys(database));
      if (!libs) {
        new Notice('Zotero Integration: could not list the Zotero libraries.');
        return null;
      }

      const result = await importAllItems(
        { settings: this.settings, database, exportFormat: format },
        libs,
        {
          isCancelled: () => this.importAllCancelRequested,
          onProgress: (p) =>
            notice?.setMessage(
              `Zotero Integration: importing "${p.library}" ` +
                `(${p.libraryIndex + 1}/${p.libraryCount}): ${p.done}/${
                  p.total
                }`
            ),
        }
      );

      const summary = [
        `Zotero Integration: import all ${
          result.aborted
            ? 'aborted: the first items all failed (check the template and that Zotero is running)'
            : result.cancelled
            ? 'stopped'
            : 'finished'
        }.`,
        `${result.written} notes written for ${result.requested} items.`,
      ];
      if (result.failed.length) {
        summary.push(`${result.failed.length} failed (see developer console).`);
        console.warn('Zotero Integration: failed citekeys', result.failed);
      }
      if (result.duplicateCiteKeys.length) {
        summary.push(
          `${result.duplicateCiteKeys.length} citekeys exist in several libraries ` +
            `and may share one note (see developer console).`
        );
        console.warn(
          'Zotero Integration: citekeys in several libraries',
          result.duplicateCiteKeys
        );
      }

      if (showProgress) new Notice(summary.join(' '), 15000);

      return result;
    } finally {
      notice?.hide();
      this.importAllRunning = false;
      this.importAllCancelRequested = false;
    }
  }

  async runImport(name: string, citekey: string, library: number = 1) {
    const format = this.settings.exportFormats.find((f) => f.name === name);

    if (!format) {
      throw new Error(`Error: Import format "${name}" not found`);
    }

    const database = {
      database: this.settings.database,
      port: this.settings.port,
    };

    if (citekey.startsWith('@')) citekey = citekey.substring(1);

    await exportToMarkdown(
      {
        settings: this.settings,
        database,
        exportFormat: format,
      },
      [{ key: citekey, library }]
    );
  }

  async openNotes(createdOrUpdatedMarkdownFilesPaths: string[]) {
    const pathOfNotesToOpen: string[] = [];
    if (this.settings.openNoteAfterImport) {
      // Depending on the choice, retreive the paths of the first, the last or all imported notes
      switch (this.settings.whichNotesToOpenAfterImport) {
        case 'first-imported-note': {
          pathOfNotesToOpen.push(createdOrUpdatedMarkdownFilesPaths[0]);
          break;
        }
        case 'last-imported-note': {
          pathOfNotesToOpen.push(
            createdOrUpdatedMarkdownFilesPaths[
              createdOrUpdatedMarkdownFilesPaths.length - 1
            ]
          );
          break;
        }
        case 'all-imported-notes': {
          pathOfNotesToOpen.push(...createdOrUpdatedMarkdownFilesPaths);
          break;
        }
      }
    }

    // Force a 1s delay after importing the files to make sure that notes are created before attempting to open them.
    // A better solution could surely be found to refresh the vault, but I am not sure how to proceed!
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const leaves = this.app.workspace.getLeavesOfType('markdown');
    for (const path of pathOfNotesToOpen) {
      const note = this.app.vault.getAbstractFileByPath(path);
      const open = leaves.find(
        (leaf) => (leaf.view as EditableFileView).file === note
      );
      if (open) {
        app.workspace.revealLeaf(open);
      } else if (note instanceof TFile) {
        await this.app.workspace.getLeaf(true).openFile(note);
      }
    }
  }

  async loadSettings() {
    const loadedSettings = await this.loadData();

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedSettings,
    };
  }

  async saveSettings() {
    this.emitter.trigger('settingsUpdated');
    await this.saveData(this.settings);
  }

  deactivateDataExplorer() {
    this.app.workspace.detachLeavesOfType(viewType);
  }

  async activateDataExplorer() {
    this.deactivateDataExplorer();
    const leaf = this.app.workspace.createLeafBySplit(
      this.app.workspace.activeLeaf,
      'vertical'
    );

    await leaf.setViewState({
      type: viewType,
    });
  }

  async updatePDFUtility() {
    const { exeOverridePath, _exeInternalVersion, exeVersion } = this.settings;
    if (exeOverridePath || !exeVersion) return;

    if (
      exeVersion !== currentVersion ||
      !_exeInternalVersion ||
      _exeInternalVersion !== internalVersion
    ) {
      const modal = new LoadingModal(
        app,
        'Updating Obsidian Zotero Integration PDF Utility...'
      );
      modal.open();

      try {
        const success = await downloadAndExtract();

        if (success) {
          this.settings.exeVersion = currentVersion;
          this.settings._exeInternalVersion = internalVersion;
          this.saveSettings();
        }
      } catch {
        //
      }

      modal.close();
    }
  }
}
