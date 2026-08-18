"""faster-whisper 本地转写（免费、私密）。

模型获取顺序：
1. 若 model_size 是一个已存在的本地目录路径，直接加载（支持离线部署）；
2. 否则从 ModelScope（国内稳定可达）下载 Systran/faster-whisper-<size>
   到 server/models/ 目录缓存，之后复用。
"""
import threading
from pathlib import Path

import requests
from faster_whisper import WhisperModel

from config import DEFAULT_LANGUAGE, DEFAULT_WHISPER_MODEL

MODELS_DIR = Path(__file__).resolve().parent / "models"
MODELSCOPE_BASE = "https://modelscope.cn/models/Systran/faster-whisper-{size}/resolve/master"
MODEL_FILES = ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"]
KNOWN_SIZES = {"tiny", "base", "small", "medium", "large-v3", "large-v2", "large"}

_model_lock = threading.Lock()
_models: dict[str, WhisperModel] = {}


def _ensure_model(size: str, on_model_progress=None) -> str:
    """返回模型目录路径，必要时先从 ModelScope 下载。

    on_model_progress: 0~1 的回调（按已下载字节 / 总字节估算）。
    """
    p = Path(size)
    if p.exists():
        return str(p)
    if size not in KNOWN_SIZES:
        raise RuntimeError(f"未知模型：{size}（支持 {sorted(KNOWN_SIZES)}，或传入本地模型目录路径）")

    d = MODELS_DIR / f"faster-whisper-{size}"
    if (d / "model.bin").exists():
        return str(d)

    d.mkdir(parents=True, exist_ok=True)
    base = MODELSCOPE_BASE.format(size=size)
    for fname in MODEL_FILES:
        target = d / fname
        if target.exists() and target.stat().st_size > 0:
            continue
        url = f"{base}/{fname}"
        print(f"[模型] 下载 {size}/{fname} (ModelScope) ...", flush=True)
        resp = requests.get(url, stream=True, timeout=600)
        resp.raise_for_status()
        total = int(resp.headers.get("content-length") or 0)
        done = 0
        with open(target, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                if chunk:
                    f.write(chunk)
                    done += len(chunk)
                    if on_model_progress and total:
                        on_model_progress(min(done / total, 1.0))
        print(f"[模型] {size}/{fname} OK", flush=True)
    return str(d)


def _get_model(size: str, on_model_progress=None) -> WhisperModel:
    with _model_lock:
        if size not in _models:
            path = _ensure_model(size, on_model_progress=on_model_progress)
            _models[size] = WhisperModel(path, device="cpu", compute_type="int8")
        return _models[size]


def transcribe(audio_path: str, model_size: str = DEFAULT_WHISPER_MODEL,
               language: str = DEFAULT_LANGUAGE,
               on_model_progress=None, on_transcribe_progress=None):
    """转写音频，返回 (segments, language_info)。

    on_model_progress: 0~1（模型下载进度，仅首次下载时触发）
    on_transcribe_progress: 0~1（按已转写音频秒数 / 总时长）
    """
    model = _get_model(model_size, on_model_progress=on_model_progress)
    segments_iter, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,              # 跳过静音段，减少废话
        beam_size=1,                  # 贪婪解码：最快（后面有 Claude 纠错兜底）
        condition_on_previous_text=False,  # 不依赖前文，更快且对短片段更稳
    )
    total_dur = float(info.duration or 0)
    segments = []
    for s in segments_iter:
        if s.text and s.text.strip():
            segments.append({
                "start": round(s.start, 1),
                "end": round(s.end, 1),
                "text": s.text.strip(),
            })
        if on_transcribe_progress and total_dur > 0:
            on_transcribe_progress(min(float(s.end) / total_dur, 1.0))
    return segments, info
