export type QueueStatus = "queued" | "running" | "done" | "error";

export interface QueueItem {
    id: string;
    url: string;
    title: string;
    platform: string;
    status: QueueStatus;
    progress: string;
    percent: number;
    eta: number | null;
    jobId: string | null;
    notePath: string | null;
    error: string | null;
    createdAt: number;
}

export function fmtEta(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    if (m > 0) return `${m} 分 ${sec} 秒`;
    return `${sec} 秒`;
}

export function genId(): string {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
