"""本地服务入口：Obsidian 插件通过 HTTP 调用。

端点：
  GET  /health          健康检查（插件用它判断服务是否已启动）
  POST /jobs            {"url": "...", "options": {...}} -> {"job_id": "..."}
  GET  /jobs/{id}       轮询任务状态/结果
"""
import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# 说明：Whisper 模型默认从 ModelScope 下载（见 transcribe.py），无需额外配置。

import imageio_ffmpeg

from config import DEFAULT_PORT, DEFAULT_WHISPER_MODEL, WORK_DIR
from downloaders import download_audio, guess_platform
from summarize import summarize
from transcribe import transcribe

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vnote")


def _job_get(job_id: str) -> dict | None:
    with JOBS_LOCK:
        return JOBS.get(job_id)


def _set_progress(job_id: str, text: str, stage: str, percent: float | None = None) -> None:
    """更新进度文本 + 阶段 + 整体百分比，并据此外推剩余时间(eta)。"""
    with JOBS_LOCK:
        j = JOBS.get(job_id)
        if not j:
            return
        now = time.time()
        # 阶段切换时重置外推基准，避免跨阶段跳变导致 eta 失真
        if j.get("_stage") != stage:
            j["_stage"] = stage
            j["_last_p"] = None
            j["_last_t"] = None
            j["eta"] = None
        j["progress"] = text
        j["stage"] = stage
        if percent is not None:
            p = max(0.0, min(100.0, float(percent)))
            j["percent"] = round(p, 1)
            lp = j.get("_last_p")
            lt = j.get("_last_t")
            if lp is not None and p > lp + 0.5 and now - lt >= 1.5:
                rate = (p - lp) / (now - lt)  # 每秒百分比
                if rate > 1e-4:
                    j["eta"] = int(round((100.0 - p) / rate))
            j["_last_p"] = p
            j["_last_t"] = now


def _run_job(job_id: str, url: str, options: dict) -> None:
    workdir = WORK_DIR / job_id
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        def set_p(text: str, stage: str, percent: float | None = None):
            _set_progress(job_id, text, stage, percent)

        set_p("解析链接、下载音频中…", "download", 1)
        audio_path, info = download_audio(
            url, workdir,
            progress_cb=lambda t, f: set_p(t, "download", f * 20),
            cookies=options.get("cookies"),
        )

        set_p("提取音频…", "extract", 21)
        wav_path = workdir / "audio16k.wav"
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        proc = subprocess.run(
            [ffmpeg, "-y", "-i", str(audio_path), "-ar", "16000", "-ac", "1", str(wav_path)],
            capture_output=True, text=True, timeout=1800,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg 提取音频失败：{proc.stderr[-300:]}")

        model_size = options.get("whisper_model", DEFAULT_WHISPER_MODEL)
        set_p(f"转写旁白中…（模型 {model_size}）", "transcribe", 40)
        segments, _info = transcribe(
            str(wav_path),
            model_size=model_size,
            on_model_progress=lambda f: set_p(
                f"下载 Whisper 模型中…（{int(f * 100)}%）", "model_download", 22 + f * 18),
            on_transcribe_progress=lambda f: set_p(
                f"转写旁白中…（{int(f * 100)}%）", "transcribe", 40 + f * 40),
        )
        if not segments:
            raise RuntimeError("转写结果为空（视频可能没有语音）")

        # 修改1：转写完成，立即删除音频与 wav，不保留占用空间
        for p in (audio_path, wav_path):
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass

        set_p("Claude 重排中…", "summarize", 80)
        # 重排阶段无精确进度，给出粗略 ETA（约 1-2 分钟）
        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["eta"] = 90

        platform = guess_platform(url)
        meta = {
            "title": info.get("title") or "未命名视频",
            "platform": platform,
            "uploader": info.get("uploader") or info.get("channel") or "未知",
            "duration": int(info.get("duration") or 0),
            "webpage_url": info.get("webpage_url") or url,
            "upload_date": info.get("upload_date") or "",
        }
        markdown = summarize(segments, meta, options)

        set_p("完成", "done", 100)
        with JOBS_LOCK:
            JOBS[job_id].update({
                "status": "done",
                "progress": "完成",
                "eta": 0,
                "result": {"markdown": markdown, "meta": meta},
            })
    except Exception as e:  # noqa: BLE001
        with JOBS_LOCK:
            JOBS[job_id].update({"status": "error", "error": str(e)})
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # 静默访问日志
        pass

    def _send(self, code: int, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/health":
            self._send(200, {"ok": True})
            return
        if path.startswith("/jobs/"):
            job_id = path[len("/jobs/"):]
            job = _job_get(job_id)
            if job is None:
                self._send(404, {"error": "job not found"})
                return
            resp = {k: job.get(k) for k in ("status", "progress", "error", "result", "stage", "percent", "eta")}
            self._send(200, resp)
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/jobs":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._send(400, {"error": "invalid JSON"})
            return
        url = (data.get("url") or "").strip()
        if not url:
            self._send(400, {"error": "缺少 url"})
            return
        job_id = uuid.uuid4().hex[:12]
        with JOBS_LOCK:
            JOBS[job_id] = {"status": "pending", "progress": "排队中…", "error": None, "result": None}
        EXECUTOR.submit(_run_job, job_id, url, data.get("options") or {})
        self._send(200, {"job_id": job_id})


def main():
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    # 启动时清理上次遗留的临时文件（服务被强杀时 finally 可能未执行）
    for d in WORK_DIR.iterdir():
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"VideoNote server listening on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
