#!/bin/bash
# 安装脚本：
#   1. 把 Python 本地服务安装到 ~/obsidian-video-note/（独立于开发目录，含重建的 venv）
#   2. 把构建好的插件复制进 Obsidian vault 的插件目录
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/obsidian-video-note"
VAULT="${VAULT:-$HOME/Documents/Obsidian Vault}"
PLUGIN_NAME="obsidian-video-note"

echo "==> [1/3] 安装本地服务到 $DEST"
mkdir -p "$DEST"
if command -v rsync >/dev/null; then
  rsync -a --delete --exclude venv --exclude work --exclude work-test --exclude __pycache__ \
    --exclude .hf-cache --exclude ".npm-cache" "$SRC/server/" "$DEST/server/"
else
  cp -R "$SRC/server/." "$DEST/server/" 2>/dev/null || true
fi

if [ ! -x "$DEST/server/venv/bin/python" ]; then
  echo "==> [2/3] 重建 Python 虚拟环境并安装依赖（首次需要几分钟）"
  # 需要 Python 3.10+（ctranslate2/faster-whisper 在 3.9 无 wheel）
  PYTHON_BIN="${PYTHON_BIN:-}"
  if [ -z "$PYTHON_BIN" ]; then
    for c in /usr/local/bin/python3.10 /opt/homebrew/bin/python3.10 python3.11 python3.12 python3; do
      if command -v "$c" >/dev/null 2>&1; then PYTHON_BIN="$c"; break; fi
    done
  fi
  echo "   使用 Python: $PYTHON_BIN"
  PIP_INDEX="${PIP_INDEX:-https://pypi.tuna.tsinghua.edu.cn/simple}"   # 国内网络默认清华镜像，可覆盖
  "$PYTHON_BIN" -m venv "$DEST/server/venv"
  "$DEST/server/venv/bin/pip" install --timeout 180 --retries 8 --upgrade pip -q
  "$DEST/server/venv/bin/pip" install --timeout 180 --retries 8 -q --index-url "$PIP_INDEX" -r "$DEST/server/requirements.txt"
else
  echo "==> [2/3] venv 已存在，跳过依赖安装"
fi

echo "==> [3/3] 安装插件到 vault: $VAULT/.obsidian/plugins/$PLUGIN_NAME"
PLUGIN_DIR="$VAULT/.obsidian/plugins/$PLUGIN_NAME"
mkdir -p "$PLUGIN_DIR"
cp "$SRC/plugin/main.js" "$SRC/plugin/manifest.json" "$SRC/plugin/styles.css" "$PLUGIN_DIR/"

echo ""
echo "完成！请在 Obsidian 中：设置 -> 第三方插件 -> 启用「视频笔记助手」。"
echo "插件默认会从 $DEST/server 启动本地服务（如需调整，在插件设置里改路径）。"
