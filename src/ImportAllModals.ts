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

/** Simple OK / Cancel dialog. Resolves true on OK. */
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

        new Setting(this.contentEl)
          .addButton((b) =>
            b.setButtonText('Cancel').onClick(() => this.close())
          )
          .addButton((b) =>
            b
              .setButtonText(okText)
              .setCta()
              .onClick(() => {
                result = true;
                this.close();
              })
          );
      }
      onClose() {
        this.contentEl.empty();
        resolve(result);
      }
    }

    new ConfirmModal(app).open();
  });
}
