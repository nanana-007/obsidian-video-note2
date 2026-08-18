"""本地服务配置。"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
WORK_DIR = BASE_DIR / "work"            # 临时下载/转写目录（任务结束自动清理）
DEFAULT_PORT = 8765

# 转写
DEFAULT_WHISPER_MODEL = "medium"        # tiny / base / small / medium / large-v3
DEFAULT_LANGUAGE = "zh"

# Claude 重排
DEFAULT_CLAUDE_MODE = "claude_cli"       # claude_cli / claude_api / codex_cli / openai_api
DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514"
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MAX_TOKENS = 8000

# OpenAI / Codex 重排
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"

# 重排提示词（旁白 -> markdown 笔记）
SYSTEM_PROMPT = (
    "你是一名资深内容整理编辑。用户会给你一段视频旁白（带时间戳）和视频元信息，"
    "请把它重排成结构清晰、适合个人知识库的 Markdown 中文笔记。"
    "要求：\n"
    "1. 保留原意，不虚构内容，不要添加视频里没有的观点；\n"
    "2. 去除口头禅、重复、语气词；\n"
    "3. 按逻辑组织成小节，重要观点尽量用时间戳标注出处；\n"
    "4. 输出严格为 Markdown，不要用代码块包裹全文。\n"
)

NOTE_PROMPT_TEMPLATE = """视频信息：
- 标题：{title}
- 平台：{platform}
- 作者：{uploader}
- 时长：{duration}

旁白全文（时间戳格式 MM:SS，[00:00] 表示 mm:ss）：
{transcript}

请输出以下结构的 Markdown 笔记（不要输出代码块围栏）：
## 摘要
两三句话概括视频内容。

## 核心要点
- 提炼 5-10 条最有价值的信息或观点，每条尽量标注对应时间戳。

## 分段笔记
按主题分成若干小节，每节一个小标题，正文要点式列出，重要处标注时间戳。

## 金句
- 引用 2-5 句原话（带时间戳）。
"""

RAW_APPENDIX_TEMPLATE = """

## 原始旁白
{transcript}
"""
