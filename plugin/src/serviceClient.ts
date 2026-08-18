import { spawn } from "child_process";
import { homedir } from "os";

/** 展开路径开头的 ~ */
export function expandHome(p: string): string {
    if (!p) return p;
    if (p === "~") return homedir();
    if (p.startsWith("~/")) return homedir() + p.slice(1);
    return p;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function checkHealth(port: number, timeoutMs = 2500): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
        return resp.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

/** 以独立进程拉起本地 Python 服务（插件退出后仍可常驻，便于下次复用） */
export function startServer(pythonPath: string, scriptPath: string, port: number): void {
    const child = spawn(expandHome(pythonPath), [expandHome(scriptPath), "--port", String(port)], {
        detached: true,
        stdio: "ignore",
    });
    child.on("error", (err) => {
        console.error("VideoNote: 服务启动失败", err);
    });
    child.unref();
}

/** 等待服务就绪，最多 waitMs 毫秒 */
export async function waitForServer(port: number, waitMs = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < waitMs) {
        if (await checkHealth(port)) return true;
        await sleep(1000);
    }
    return false;
}

export async function submitJob(url: string, options: Record<string, unknown>, port: number): Promise<string> {
    const resp = await fetch(`http://127.0.0.1:${port}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, options }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error((data as { error?: string }).error || "提交任务失败");
    return (data as { job_id: string }).job_id;
}

export interface JobResult {
    status: string;
    progress?: string;
    error?: string;
    stage?: string;
    percent?: number;
    eta?: number | null;
    result?: { markdown: string; meta: Record<string, unknown> };
}

/** 单次查询任务状态（供队列轮询用） */
export async function fetchJob(port: number, jobId: string): Promise<JobResult> {
    const resp = await fetch(`http://127.0.0.1:${port}/jobs/${jobId}`);
    if (resp.status === 404) {
        throw new Error("任务已不存在（服务可能已重启），请重新加入队列");
    }
    return (await resp.json()) as JobResult;
}

/** 轮询任务直到完成/出错，期间回调完整进度数据 */
export async function pollJob(port: number, jobId: string, onProgress?: (d: JobResult) => void): Promise<JobResult> {
    for (;;) {
        const resp = await fetch(`http://127.0.0.1:${port}/jobs/${jobId}`);
        const data = (await resp.json()) as JobResult;
        onProgress?.(data);
        if (data.status === "done") return data;
        if (data.status === "error") throw new Error(data.error || "处理失败");
        if (data.status === "pending" || data.status === "running") {
            await sleep(2000);
            continue;
        }
        throw new Error("未知任务状态：" + data.status);
    }
}
