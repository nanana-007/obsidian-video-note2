"""链接解析与音频下载。

B站免登录；抖音/小红书需要 cookie（登录态），可在插件设置中提供：
- Cookie 字符串（如浏览器里复制 douyin.com 的 cookie），或
- Netscape 格式 cookies.txt 文件路径。
"""
import time
from pathlib import Path

import yt_dlp


def guess_platform(url: str) -> str:
    if "bilibili.com" in url or "b23.tv" in url:
        return "bilibili"
    if "douyin.com" in url or "iesdouyin.com" in url:
        return "douyin"
    if "xiaohongshu.com" in url or "xhslink.com" in url:
        return "xiaohongshu"
    if "youtube.com" in url or "youtu.be" in url:
        return "youtube"
    return "unknown"


def _prepare_cookies(cookies, workdir: Path):
    """返回 yt-dlp 的 cookiefile 路径；cookies 可为文件路径或 "k=v; k2=v2" 字符串。"""
    if not cookies:
        return None
    p = Path(cookies).expanduser()
    if p.is_file():
        return str(p)
    # 视为 cookie 字符串，转成 Netscape 格式
    lines = ["# Netscape HTTP Cookie File"]
    ts = int(time.time()) + 30 * 24 * 3600
    for pair in str(cookies).split(";"):
        if "=" not in pair:
            continue
        k, v = pair.strip().split("=", 1)
        for domain in (".douyin.com", ".xiaohongshu.com"):
            lines.append(f"{domain}\tTRUE\t/\tTRUE\t{ts}\t{k}\t{v}")
    out = workdir / "cookies.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    return str(out)


def download_audio(url: str, workdir: Path, progress_cb=None, cookies=None):
    """下载最佳音频流，返回 (音频文件路径, 视频元信息 dict)。"""
    platform = guess_platform(url)
    cookiefile = _prepare_cookies(cookies, workdir)

    def hook(d):
        if progress_cb and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            if total:
                progress_cb(
                    f"下载音频 {downloaded // 1024 // 1024}MB / {total // 1024 // 1024}MB",
                    min(downloaded / total, 1.0),
                )

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(workdir / "audio.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "retries": 3,
        "overwrites": True,
        "progress_hooks": [hook],
        "ignoreerrors": False,
    }
    if cookiefile:
        opts["cookiefile"] = cookiefile

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        if platform in ("douyin", "xiaohongshu") and not cookiefile:
            raise RuntimeError(
                f"{'抖音' if platform == 'douyin' else '小红书'}需要 Cookie 才能解析。"
                f"请在插件设置里填写该平台的 Cookie（浏览器登录后复制）。原始错误：{msg[-200:]}"
            )
        raise RuntimeError(f"视频解析失败（{platform}）：{msg[-200:]}")

    if info is None:
        raise RuntimeError("视频解析失败：请检查链接是否有效")

    # 定位实际下载的音频文件（bestaudio 时扩展名可能与 prepare_filename 不一致）
    candidates = sorted(workdir.glob("audio.*"))
    candidates = [c for c in candidates if c.suffix not in (".part", ".ytdl", ".json")]
    if not candidates:
        raise RuntimeError("音频下载失败：未找到输出文件")
    audio_path = candidates[0]

    return audio_path, info
