import { App, TFile, moment, normalizePath } from "obsidian";

export interface NoteMeta {
    title?: string;
    platform?: string;
    uploader?: string;
    duration?: number;
    webpage_url?: string;
    upload_date?: string;
}

export function safeFilename(title: string): string {
    const cleaned = (title || "视频笔记")
        .replace(/[\\/:*?"<>|#^[\]{}]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    return cleaned || "视频笔记";
}

export function buildMarkdown(meta: NoteMeta, body: string, tags: string): string {
    const date = moment().format("YYYY-MM-DD");
    const dur = meta.duration || 0;
    const platformNames: Record<string, string> = {
        bilibili: "B站",
        douyin: "抖音",
        xiaohongshu: "小红书",
        youtube: "YouTube",
        unknown: "未知",
    };
    return [
        "---",
        `平台: ${platformNames[meta.platform || "unknown"] || meta.platform}`,
        `标题: "${meta.title || ""}"`,
        `作者: "${meta.uploader || ""}"`,
        `来源: ${meta.webpage_url || ""}`,
        `采集日期: ${date}`,
        `时长: ${Math.floor(dur / 60)}分${dur % 60}秒`,
        `标签: ["${tags}"]`,
        "---",
        "",
        body.trim(),
        "",
    ].join("\n");
}

async function ensureFolder(app: App, folder: string): Promise<void> {
    const normalized = normalizePath(folder);
    if (normalized && !app.vault.getAbstractFileByPath(normalized)) {
        await app.vault.createFolder(normalized);
    }
}

/** 写入笔记；文件名冲突时自动追加 -1/-2 后缀 */
export async function writeNote(
    app: App,
    folder: string,
    filename: string,
    content: string,
): Promise<TFile> {
    await ensureFolder(app, folder);
    const base = folder ? `${normalizePath(folder)}/${filename}` : filename;
    let path = base;
    let i = 1;
    while (app.vault.getAbstractFileByPath(path)) {
        const dot = base.lastIndexOf(".");
        path = dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`;
        i++;
    }
    return app.vault.create(path, content);
}
