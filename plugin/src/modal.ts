import { App, Modal, Notice, Setting } from "obsidian";

export class LinkPromptModal extends Modal {
    constructor(
        app: App,
        private readonly onSubmit: (url: string) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "从视频链接生成笔记" });
        contentEl.createEl("p", {
            text: "支持 B站 / 抖音 / 小红书（视频号暂不支持）。粘贴视频分享链接：",
        });
        const textarea = contentEl.createEl("textarea", {
            attr: {
                rows: "3",
                placeholder: "https://www.bilibili.com/video/…",
                style: "width: 100%; font-family: monospace;",
            },
        });
        textarea.focus();

        new Setting(contentEl).addButton((b) =>
            b.setButtonText("开始处理").setCta().onClick(() => {
                const url = textarea.value.trim();
                if (!url) {
                    new Notice("请先粘贴视频链接");
                    return;
                }
                this.close();
                this.onSubmit(url);
            }),
        );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class ProgressModal extends Modal {
    private statusEl!: HTMLElement;
    private barEl!: HTMLProgressElement;
    private pctEl!: HTMLElement;
    private etaEl!: HTMLElement;
    private etaValue: number | null = null;
    private etaTimer: number | null = null;

    constructor(app: App) {
        super(app);
        this.titleEl.setText("视频处理中…");
    }

    onOpen(): void {
        this.modalEl.style.minWidth = "400px";
        this.barEl = this.contentEl.createEl("progress", {
            attr: { max: "100", value: "0", style: "width: 100%;" },
        });
        this.pctEl = this.contentEl.createEl("div", { text: "0%", cls: "vnote-pct" });
        this.statusEl = this.contentEl.createEl("div", { text: "准备中…", cls: "vnote-status" });
        this.etaEl = this.contentEl.createEl("div", { text: "", cls: "vnote-eta" });
    }

    update(d: { progress?: string; percent?: number; eta?: number | null }): void {
        const p = d.percent ?? 0;
        if (this.barEl) this.barEl.value = p;
        if (this.pctEl) this.pctEl.setText(`${Math.round(p)}%`);
        if (this.statusEl && d.progress) this.statusEl.setText(d.progress);
        if (d.eta != null) {
            if (d.eta > 0) {
                this.etaValue = d.eta;
                this.startCountdown();
            } else {
                this.stopCountdown();
                this.etaEl.setText("");
            }
        }
    }

    private startCountdown(): void {
        if (this.etaTimer != null) return;
        this.renderEta();
        this.etaTimer = window.setInterval(() => {
            if (this.etaValue != null && this.etaValue > 0) {
                this.etaValue -= 1;
                this.renderEta();
            } else {
                this.stopCountdown();
            }
        }, 1000);
    }

    private stopCountdown(): void {
        if (this.etaTimer != null) {
            window.clearInterval(this.etaTimer);
            this.etaTimer = null;
        }
    }

    private renderEta(): void {
        if (this.etaEl && this.etaValue != null && this.etaValue > 0) {
            this.etaEl.setText(`预计剩余 ${fmtEta(this.etaValue)}`);
        }
    }

    onClose(): void {
        this.stopCountdown();
        this.contentEl.empty();
    }
}

function fmtEta(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    if (m > 0) return `${m} 分 ${sec} 秒`;
    return `${sec} 秒`;
}
