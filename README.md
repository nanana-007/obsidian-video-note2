# Obsidian 视频笔记助手 (Video to Note)

粘贴视频链接 → 自动下载音频 → Whisper 本地转写旁白 → Claude 重排 → 生成 Markdown 笔记写入 Obsidian。

支持平台：**B站（最稳） / 抖音 / 小红书**（视频号不支持——纯链接无法直接下载）。

## 架构

```
Obsidian 插件 (TypeScript)
   └── HTTP (127.0.0.1:8765)
        └── Python 本地服务
             ├── yt-dlp         下载音频
             ├── ffmpeg         提取/转换音频
             ├── faster-whisper 转写旁白（本地、免费、私密）
             └── Claude         重排为结构化笔记
                  ├── cli 模式：Claude Code（走订阅额度）
                  └── api 模式：Anthropic API（按量付费）
```

## 目录

```
obsidian-video-note/
├── server/       Python 本地服务（venv 在 server/venv）
│   ├── main.py           HTTP 入口 + 任务管理
│   ├── downloaders/      链接解析/下载（yt-dlp）
│   ├── transcribe.py     faster-whisper 转写
│   ├── summarize.py      Claude CLI/API 重排
│   └── config.py         配置与提示词
├── plugin/       Obsidian 插件（TypeScript）
│   └── src/
│       ├── main.ts        入口：命令/面板/处理流程
│       ├── settings.ts    设置项
│       ├── serviceClient.ts  调用本地服务
│       ├── noteWriter.ts  生成并写入笔记
│       └── modal.ts       链接输入 / 进度弹窗
└── install.sh    一键安装到 ~/obsidian-video-note 与 vault
```

## 开发

```bash
# 服务端（首次装依赖）
cd server
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python main.py --port 8765

# 插件
cd plugin
npm install
npm run build        # 产物 main.js
npm run dev          # 监听式构建
```

## 安装到 Obsidian

```bash
./install.sh
```

然后在 Obsidian：设置 → 第三方插件 → 启用「视频笔记助手」→ 点左侧视频图标或命令面板执行「从视频链接生成笔记」。

## 笔记模板

生成结果形如：

```markdown
---
平台: B站
标题: "…"
作者: "…"
来源: https://www.bilibili.com/video/…
采集日期: 2025-…
时长: 12分34秒
标签: ["视频笔记"]
---

## 摘要
## 核心要点
## 分段笔记
## 金句
## 原始旁白（可关闭）
```

## 已知限制

- 抖音/小红书存在反爬，偶尔解析失败，会给出明确报错；
- 首次转写需下载 Whisper 模型（medium 约 1.5GB，之后缓存复用）；
- Claude CLI 模式需本机安装 Claude Code 并完成登录；也可改用 API key 模式。
