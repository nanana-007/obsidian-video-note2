import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, VideoNoteSettings, VideoNoteSettingTab } from "./settings";
import {
    checkHealth,
    fetchJob,
    JobResult,
    startServer,
    submitJob,
    waitForServer,
} from "./serviceClient";
import { buildMarkdown, NoteMeta, safeFilename, writeNote } from "./noteWriter";
import { genId, QueueItem } from "./queue";
import { QUEUE_VIEW_TYPE, QueueView } from "./queueView";

interface PluginData {
    settings?: Partial<VideoNoteSettings>;
    queue?: QueueItem[];
}

export default class VideoNotePlugin extends Plugin {
    settings: VideoNoteSettings;
    queue: QueueItem[] = [];
    queueView: QueueView | null = null;
    private pollTimer: number | null = null;

    async onload() {
        await this.loadSettings();

        this.registerView(QUEUE_VIEW_TYPE, (leaf) => new QueueView(leaf, this));

        this.addRibbonIcon("video", "视频笔记助手：打开任务队列", () => {
            void this.activateView();
        });

        this.addCommand({
            id: "video-to-note",
            name: "打开视频笔记队列",
            callback: () => void this.activateView(),
        });

        this.addSettingTab(new VideoNoteSettingTab(this.app, this));

        if (this.settings.autoStartServer) {
            void this.ensureServer();
        }

        // 恢复未完成任务的轮询
        this.ensurePolling();
    }

    onunload() {
        if (this.pollTimer != null) {
            window.clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async loadSettings() {
        const data = (await this.loadData()) as PluginData | null;
        // 兼容旧版：旧数据是平铺的 settings
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? data);
        this.queue = data?.queue ?? [];
    }

    async saveSettings() {
        const payload: PluginData = { settings: this.settings, queue: this.queue };
        await this.saveData(payload);
    }

    async persistQueue() {
        await this.saveSettings();
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(QUEUE_VIEW_TYPE)[0];
        if (!leaf) {
            leaf = workspace.getLeftLeaf(false) as WorkspaceLeaf;
            await leaf.setViewState({ type: QUEUE_VIEW_TYPE, active: true });
        }
        await workspace.revealLeaf(leaf);
    }

    async ensureServer(): Promise<boolean> {
        if (await checkHealth(this.settings.port)) return true;
        startServer(this.settings.pythonPath, this.settings.serverScript, this.settings.port);
        const ok = await waitForServer(this.settings.port);
        if (!ok) {
            new Notice("本地服务启动失败，请在设置中检查 Python / 服务脚本路径");
        }
        return ok;
    }

    private buildOptions() {
        return {
            claude_mode: this.settings.claudeMode,
            api_key: this.settings.apiKey,
            claude_model: this.settings.claudeModel,
            openai_api_key: this.settings.openaiApiKey,
            openai_model: this.settings.openaiModel,
            whisper_model: this.settings.whisperModel,
            include_raw: this.settings.includeRaw,
            cookies: this.settings.cookies,
        };
    }

    async addToQueue(urls: string[]): Promise<void> {
        const valid = urls.filter((u) => /^https?:\/\//i.test(u.trim()));
        if (valid.length === 0) {
            new Notice("没有有效的链接（需以 http:// 或 https:// 开头）");
            return;
        }
        for (const url of valid) {
            const item: QueueItem = {
                id: genId(),
                url: url.trim(),
                title: url.trim(),
                platform: "",
                status: "queued",
                progress: "排队中",
                percent: 0,
                eta: null,
                jobId: null,
                notePath: null,
                error: null,
                createdAt: Date.now(),
            };
            this.queue.unshift(item);
        }
        await this.persistQueue();
        this.queueView?.refresh();
        await this.kick();
    }

    /** 把排队中的任务提交到本地服务（服务端串行处理，天然排队） */
    async kick(): Promise<void> {
        if (!(await this.ensureServer())) return;
        for (const item of this.queue) {
            if (item.status === "queued" && !item.jobId) {
                try {
                    item.jobId = await submitJob(item.url, this.buildOptions(), this.settings.port);
                    item.progress = "已提交，等待处理";
                } catch (e) {
                    item.status = "error";
                    item.error = (e as Error).message;
                }
            }
        }
        await this.persistQueue();
        this.queueView?.refresh();
        this.ensurePolling();
    }

    private ensurePolling(): void {
        if (this.pollTimer != null) return;
        this.pollTimer = window.setInterval(() => void this.pollAll(), 2000);
        this.registerInterval(this.pollTimer);
    }

    async pollAll(): Promise<void> {
        const active = this.queue.filter(
            (q) => q.jobId && (q.status === "queued" || q.status === "running"),
        );
        if (active.length === 0) return;

        let changed = false;
        for (const item of active) {
            try {
                const d: JobResult = await fetchJob(this.settings.port, item.jobId!);
                item.progress = d.progress ?? item.progress;
                if (d.percent != null) item.percent = d.percent;
                if (d.eta != null) item.eta = d.eta;
                if (d.status === "done") {
                    item.status = "done";
                    item.progress = "完成";
                    item.percent = 100;
                    item.eta = 0;
                    await this.finishItem(item, d);
                } else if (d.status === "error") {
                    item.status = "error";
                    item.error = d.error ?? "处理失败";
                } else {
                    item.status = "running";
                }
                changed = true;
            } catch (e) {
                if (item.status === "running" || item.status === "queued") {
                    item.error = (e as Error).message;
                }
                changed = true;
            }
        }
        if (changed) {
            await this.persistQueue();
            this.queueView?.refresh();
        }
    }

    async finishItem(item: QueueItem, d: JobResult): Promise<void> {
        if (item.notePath) return;
        try {
            const meta = (d.result?.meta ?? {}) as NoteMeta;
            const content = buildMarkdown(meta, d.result?.markdown ?? "", this.settings.tags);
            const file = await writeNote(
                this.app,
                this.settings.saveFolder,
                safeFilename((meta.title as string) || "视频笔记") + ".md",
                content,
            );
            item.title = (meta.title as string) || item.url;
            item.platform = (meta.platform as string) || "";
            item.notePath = file.path;
        } catch (e) {
            item.status = "error";
            item.error = "笔记写入失败：" + (e as Error).message;
        }
    }

    async clearFinished(): Promise<void> {
        this.queue = this.queue.filter((q) => q.status !== "done" && q.status !== "error");
        await this.persistQueue();
        this.queueView?.refresh();
    }

    async removeItem(id: string): Promise<void> {
        this.queue = this.queue.filter((q) => q.id !== id);
        await this.persistQueue();
        this.queueView?.refresh();
    }

    async openNote(path: string): Promise<void> {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) {
            await this.app.workspace.getLeaf(false).openFile(f);
        } else {
            new Notice("笔记文件不存在：" + path);
        }
    }
}
