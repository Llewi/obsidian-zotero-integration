import { App, Modal } from 'obsidian';

export class LoadingModal extends Modal {
  /**
   * While > 0, LoadingModals are not shown. Used by bulk operations (e.g.
   * "Import all items") that would otherwise open and close a modal for every
   * single request sent to Zotero.
   */
  private static suppressCount = 0;

  static suppress() {
    LoadingModal.suppressCount++;
  }

  static unsuppress() {
    LoadingModal.suppressCount = Math.max(0, LoadingModal.suppressCount - 1);
  }

  message: string;
  private shown = false;

  constructor(app: App, message: string) {
    super(app);
    this.message = message;
  }

  open() {
    if (LoadingModal.suppressCount > 0) return;
    this.shown = true;
    super.open();
  }

  close() {
    if (!this.shown) return;
    this.shown = false;
    super.close();
  }

  onOpen() {
    this.contentEl.createDiv({ text: this.message });
  }

  onClose() {
    this.contentEl.empty();
  }
}
