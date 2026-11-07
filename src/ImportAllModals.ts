import { App, FuzzySuggestModal, Modal, Setting } from 'obsidian';

import { ExportFormat } from './types';

/** Lets the user pick one of the configured import formats. */
export function pickExportFormat(
  app: App,
  formats: ExportFormat[]
): Promise<ExportFormat | null> {
  if (formats.length === 1) return Promise.resolve(formats[0]);

  return new Promise((resolve) => {
    let chosen: ExportFormat | null = null;

    class FormatModal extends FuzzySuggestModal<ExportFormat> {
      getItems() {
        return formats;
      }
      getItemText(item: ExportFormat) {
        return item.name;
      }
      onChooseItem(item: ExportFormat) {
        chosen = item;
      }
      onClose() {
        // onChooseItem fires before onClose; defer so `chosen` is set.
        setTimeout(() => resolve(chosen), 0);
      }
    }

    const modal = new FormatModal(app);
    modal.setPlaceholder('Import all items with which import format?');
    modal.open();
  });
}

/**
 * Simple OK / Cancel dialog. Resolves true on OK. The OK button gets focus
 * when the dialog opens, so Enter confirms (Escape still cancels).
 */
export function confirm(
  app: App,
  title: string,
  body: string[],
  okText: string
): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;

    class ConfirmModal extends Modal {
      onOpen() {
        this.titleEl.setText(title);
        for (const line of body) this.contentEl.createEl('p', { text: line });

        let okButton: HTMLButtonElement | null = null;
        new Setting(this.contentEl)
          .addButton((b) =>
            b.setButtonText('Cancel').onClick(() => this.close())
          )
          .addButton((b) => {
            okButton = b.buttonEl;
            b.setButtonText(okText)
              .setCta()
              .onClick(() => {
                result = true;
                this.close();
              });
          });

        // Focus the OK button so Enter triggers it natively. Deferred because
        // Obsidian moves focus into the modal container after onOpen.
        okButton?.focus();
        window.setTimeout(() => okButton?.focus(), 0);
      }
      onClose() {
        this.contentEl.empty();
        resolve(result);
      }
    }

    new ConfirmModal(app).open();
  });
}
