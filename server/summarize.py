"""旁白重排 -> 结构化 Markdown 笔记。

支持四种引擎（插件设置里切换 claude_mode）：
- claude_cli：本机 `claude -p`（Claude Code，走订阅额度）
- claude_api：Anthropic Messages API（需 ANTHROPIC_API_KEY）
- codex_cli：本机 `codex exec`（OpenAI Codex CLI，走其订阅/登录）
- openai_api：OpenAI 兼容 Chat Completions API（需 OPENAI_API_KEY）
"""
import os
import shutil
import subprocess
from pathlib import Path

import requests

from config import (CLAUDE_API_URL, CLAUDE_MAX_TOKENS, DEFAULT_CLAUDE_MODE,
                    DEFAULT_CLAUDE_MODEL, DEFAULT_OPENAI_MODEL,
                    NOTE_PROMPT_TEMPLATE, OPENAI_API_URL,
                    RAW_APPENDIX_TEMPLATE, SYSTEM_PROMPT)


def _find_cmd(name: str, hint: str) -> str:
    """定位可执行文件：先查 PATH，再查常见安装位置。"""
    exe = shutil.which(name)
    if exe:
        return exe
    candidates = [
        Path.home() / ".npm-global/bin" / name,
        Path.home() / ".local/bin" / name,
        Path("/usr/local/bin") / name,
        Path("/opt/homebrew/bin") / name,
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    raise RuntimeError(hint)


def _find_claude() -> str:
    return _find_cmd(
        "claude",
        "未找到 claude 命令。请安装 Claude Code（curl -fsSL https://claude.ai/install.sh | bash），"
        "或在插件设置中切换其它引擎。")


def _find_codex() -> str:
    return _find_cmd(
        "codex",
        "未找到 codex 命令。请安装 OpenAI Codex CLI（npm install -g @openai/codex 并完成登录），"
        "或在插件设置中切换其它引擎。")


def _fmt_ts(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


def build_transcript(segments) -> str:
    lines = []
    for seg in segments:
        lines.append(f"[{_fmt_ts(seg['start'])}] {seg['text']}")
    return "\n".join(lines)


def summarize(segments, meta: dict, options: dict) -> str:
    """返回最终 Markdown 笔记全文（含附录开关）。"""
    transcript = build_transcript(segments)
    mode = options.get("claude_mode", DEFAULT_CLAUDE_MODE)

    prompt = NOTE_PROMPT_TEMPLATE.format(
        title=meta.get("title", "未命名"),
        platform=meta.get("platform", ""),
        uploader=meta.get("uploader", "未知"),
        duration=f"{meta.get('duration', 0) // 60}分{meta.get('duration', 0) % 60}秒",
        transcript=transcript,
    )

    if mode in ("codex_cli", "codex"):
        body = _summarize_codex_cli(prompt, options)
    elif mode in ("openai_api", "openai"):
        body = _summarize_openai_api(prompt, options)
    elif mode in ("claude_api", "api"):
        body = _summarize_api(prompt, options)
    else:  # claude_cli / cli / 默认
        body = _summarize_cli(prompt, options)

    body = body.strip()
    # 去掉 LLM 偶尔加上的围栏
    if body.startswith("```"):
        body = body.strip("`")
        body = body.lstrip("markdown").strip()

    if options.get("include_raw", True):
        body += RAW_APPENDIX_TEMPLATE.format(transcript=transcript)

    return body


def _summarize_cli(prompt: str, options: dict) -> str:
    model = options.get("claude_model") or DEFAULT_CLAUDE_MODEL
    claude_exe = _find_claude()
    cmd = [claude_exe, "-p", prompt, "--output-format", "text"]
    if model and model != DEFAULT_CLAUDE_MODEL:
        cmd += ["--model", model]
    env = {**os.environ, "CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(CLAUDE_MAX_TOKENS)}

    last_err = ""
    for _attempt in range(3):
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900, env=env)
        except FileNotFoundError:
            raise RuntimeError(
                f"无法运行 claude（{claude_exe}），请检查安装，或在插件设置中切换其它引擎。")
        except subprocess.TimeoutExpired:
            last_err = "Claude CLI 超时（900 秒）"
            continue
        if proc.returncode == 0:
            out = (proc.stdout or "").strip()
            if out:
                return out
            last_err = "Claude CLI 返回为空（可能需要先运行 claude 完成登录）"
            continue
        last_err = (proc.stderr or proc.stdout or "").strip()[-500:] or f"退出码 {proc.returncode}"
    raise RuntimeError(f"Claude CLI 调用失败（已重试 3 次）：{last_err}")


def _summarize_codex_cli(prompt: str, options: dict) -> str:
    codex_exe = _find_codex()
    cmd = [codex_exe, "exec", prompt]
    model = options.get("openai_model")
    if model and model != DEFAULT_OPENAI_MODEL:
        cmd += ["--model", model]
    env = {**os.environ}

    last_err = ""
    for _attempt in range(3):
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900, env=env)
        except FileNotFoundError:
            raise RuntimeError(
                f"无法运行 codex（{codex_exe}），请检查安装，或在插件设置中切换其它引擎。")
        except subprocess.TimeoutExpired:
            last_err = "Codex CLI 超时（900 秒）"
            continue
        if proc.returncode == 0:
            out = (proc.stdout or "").strip()
            if out:
                return out
            last_err = "Codex CLI 返回为空（可能需要先运行 codex 完成登录）"
            continue
        last_err = (proc.stderr or proc.stdout or "").strip()[-500:] or f"退出码 {proc.returncode}"
    raise RuntimeError(f"Codex CLI 调用失败（已重试 3 次）：{last_err}")


def _summarize_api(prompt: str, options: dict) -> str:
    api_key = options.get("api_key") or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("Claude API 模式需要 ANTHROPIC_API_KEY 或插件设置中的 API Key")
    model = options.get("claude_model") or DEFAULT_CLAUDE_MODEL
    resp = requests.post(
        CLAUDE_API_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": CLAUDE_MAX_TOKENS,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=600,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Anthropic API 错误 {resp.status_code}：{resp.text[:300]}")
    parts = [b.get("text", "") for b in resp.json().get("content", []) if b.get("type") == "text"]
    return "\n".join(parts).strip()


def _summarize_openai_api(prompt: str, options: dict) -> str:
    api_key = options.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OpenAI API 模式需要 OPENAI_API_KEY 或插件设置中的 API Key")
    model = options.get("openai_model") or DEFAULT_OPENAI_MODEL
    base_url = options.get("openai_base_url") or OPENAI_API_URL
    resp = requests.post(
        base_url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": CLAUDE_MAX_TOKENS,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        },
        timeout=600,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI API 错误 {resp.status_code}：{resp.text[:300]}")
    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError):
        raise RuntimeError("OpenAI API 返回格式异常：" + str(data)[:300])
