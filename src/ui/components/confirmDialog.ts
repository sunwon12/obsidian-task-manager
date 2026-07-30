// LLD §10: Obsidian Modal API를 사용해 confirm dialog를 띄운다.
// React 안에서 호출하지만 자체는 obsidian Modal이라 별도 파일 (.ts).

import { Modal, type App } from "obsidian";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

export function confirmDialog(app: App, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModalImpl(app, options, resolve);
    modal.open();
  });
}

class ConfirmModalImpl extends Modal {
  constructor(
    app: App,
    private readonly options: ConfirmOptions,
    private readonly resolve: (v: boolean) => void,
  ) {
    super(app);
  }

  private decided = false;

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const title = contentEl.createEl("h3", { text: this.options.title });
    title.style.marginTop = "0";
    contentEl.createEl("p", { text: this.options.message });

    const buttonRow = contentEl.createDiv();
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "flex-end";
    buttonRow.style.gap = "8px";
    buttonRow.style.marginTop = "16px";

    const cancel = buttonRow.createEl("button", {
      text: this.options.cancelText ?? "Cancel",
    });
    cancel.addEventListener("click", () => {
      this.decided = true;
      this.resolve(false);
      this.close();
    });

    const confirm = buttonRow.createEl("button", {
      text: this.options.confirmText ?? "OK",
      cls: this.options.destructive ? "mod-warning" : "mod-cta",
    });
    confirm.addEventListener("click", () => {
      this.decided = true;
      this.resolve(true);
      this.close();
    });
    confirm.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.decided) this.resolve(false);
  }
}
