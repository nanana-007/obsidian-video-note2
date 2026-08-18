import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type VideoNotePlugin from "./main";
import { fmtEta, QueueItem } from "./queue";

export const QUEUE_VIEW_TYPE = "video-note-queue";

const STATUS_LABEL: Record<string, string> = {
    queued: "排队中",
    running: "处理中",
    done: "✅ 完成",
    error: "❌ 失败",
};

export class QueueView extends ItemView {
    plugin: VideoNotePlugin;
    private listEl!: HTMLElement;
    private inputEl!: HTMLTextAreaElement;

    constructor(leaf: WorkspaceLeaf, plugin: VideoNotePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return QUEUE_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "视频笔记队列";
    }

    getIcon(): string {
        return "video";
    }

    async onOpen(): Promise<void> {
        this.plugin.queueView = this;
        const c = this.contentEl;
        c.empty();
        c.createEl("h4", { text: "视频笔记队列" });

        // —— 输入区：只创建一次，轮询刷新时不受影响 ——
        this.inputEl = c.createEl("textarea", {
            attr: {
                placeholder: "粘贴视频链接，每行一个（B站/抖音/小红书）\nhttps://www.bilibili.com/video/…\nhttps://xhslink.com/…",
                rows: "3",
                style: "width: 100%; font-family: monospace;",
            },
        });

        const inputActions = c.createEl("div", { cls: "vnote-input-actions" });
        const addBtn = inputActions.createEl("button", { text: "加入队列", cls: "vnote-primary" });
        addBtn.addEventListener("click", () => {
            const urls = this.inputEl.value.split("\n").map((s) => s.trim()).filter(Boolean);
            if (urls.length === 0) {
                new Notice("请先粘贴至少一个视频链接");
                return;
            }
            this.inputEl.value = "";
            void this.plugin.addToQueue(urls);
        });
        const clearBtn = inputActions.createEl("button", { text: "清除已完成/失败" });
        clearBtn.addEventListener("click", () => void this.plugin.clearFinished());

        c.createEl("div", {
            text: "提示：处理中/排队的任务不会被清除",
            cls: "vnote-input-hint",
        });

        // —— 列表区：单独容器，刷新时只重绘这里 ——
        this.listEl = c.createEl("div", { cls: "vnote-queue" });
        this.renderList();
    }

    /** 刷新面板（供轮询/操作后调用）：只重建列表，不清空输入框 */
    refresh(): void {
        if (this.listEl) this.renderList();
    }

    private renderList(): void {
        this.listEl.empty();
        if (this.plugin.queue.length === 0) {
            this.listEl.createEl("div", { text: "暂无任务。粘贴链接后点「加入队列」。", cls: "vnote-empty" });
        }
        for (const item of this.plugin.queue) {
            this.renderItem(this.listEl, item);
        }
    }

    private renderItem(parent: HTMLElement, item: QueueItem): void {
        const card = parent.createEl("div", { cls: "vnote-queue-item" });

        const title = item.title && item.title !== item.url ? item.title : item.url;
        card.createEl("div", { text: title, cls: "vnote-item-title" });

        const statusText = `${STATUS_LABEL[item.status] ?? item.status} · ${item.progress || ""}`;
        card.createEl("div", { text: statusText, cls: "vnote-item-status" });

        if (item.status === "queued" || item.status === "running") {
            card.createEl("progress", {
                attr: { max: "100", value: String(item.percent ?? 0), style: "width: 100%;" },
            });
            let etaText = `${Math.round(item.percent ?? 0)}%`;
            if (item.eta && item.eta > 0) etaText += ` · 预计剩余 ${fmtEta(item.eta)}`;
            card.createEl("div", { text: etaText, cls: "vnote-item-eta" });
        }

        if (item.error) {
            card.createEl("div", { text: item.error, cls: "vnote-item-error" });
        }

        if (item.notePath || item.status === "done" || item.status === "error") {
            const actions = card.createEl("div", { cls: "vnote-item-actions" });
            if (item.notePath) {
                const openBtn = actions.createEl("button", { text: "打开笔记" });
                openBtn.addEventListener("click", () => void this.plugin.openNote(item.notePath!));
            }
            if (item.status === "done" || item.status === "error") {
                const delBtn = actions.createEl("button", { text: "删除" });
                delBtn.addEventListener("click", () => void this.plugin.removeItem(item.id));
            }
        }
    }

    async onClose(): Promise<void> {
        this.plugin.queueView = null;
    }
}
