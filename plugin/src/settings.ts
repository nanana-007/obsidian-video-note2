import { App, PluginSettingTab, Setting } from "obsidian";
import type VideoNotePlugin from "./main";

export interface VideoNoteSettings {
    /** 本地服务端口 */
    port: number;
    /** Python 解释器路径（服务 venv 的 python） */
    pythonPath: string;
    /** 服务脚本 main.py 路径 */
    serverScript: string;
    /** 笔记保存文件夹（vault 内相对路径） */
    saveFolder: string;
    /** 重排引擎：claude_cli / claude_api / codex_cli / openai_api */
    claudeMode: "claude_cli" | "claude_api" | "codex_cli" | "openai_api";
    /** Anthropic API key（claude_api 模式） */
    apiKey: string;
    /** Claude 模型名 */
    claudeModel: string;
    /** OpenAI API key（openai_api 模式） */
    openaiApiKey: string;
    /** OpenAI 模型名 */
    openaiModel: string;
    /** Whisper 模型大小 */
    whisperModel: string;
    /** 是否在笔记末尾附原始旁白 */
    includeRaw: boolean;
    /** 抖音/小红书 Cookie 字符串（如 "odin_tt=xxx; passport_csrf_token=yyy"） */
    cookies: string;
    /** 插件加载时自动拉起本地服务 */
    autoStartServer: boolean;
    /** frontmatter 标签 */
    tags: string;
}

export const DEFAULT_SETTINGS: VideoNoteSettings = {
    port: 8765,
    pythonPath: "~/obsidian-video-note/server/venv/bin/python",
    serverScript: "~/obsidian-video-note/server/main.py",
    saveFolder: "视频笔记",
    claudeMode: "claude_cli",
    apiKey: "",
    claudeModel: "claude-sonnet-4-20250514",
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    whisperModel: "medium",
    includeRaw: true,
    cookies: "",
    autoStartServer: true,
    tags: "视频笔记",
};

export class VideoNoteSettingTab extends PluginSettingTab {
    plugin: VideoNotePlugin;

    constructor(app: App, plugin: VideoNotePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "视频笔记助手设置" });

        new Setting(containerEl)
            .setName("本地服务端口")
            .setDesc("本地 Python 服务监听的端口，一般无需修改")
            .addText((t) =>
                t.setValue(String(this.plugin.settings.port)).onChange(async (v) => {
                    const n = parseInt(v, 10);
                    if (!isNaN(n)) { this.plugin.settings.port = n; await this.plugin.saveSettings(); }
                }));

        new Setting(containerEl)
            .setName("Python 解释器路径")
            .setDesc("服务 venv 下的 python，如 ~/obsidian-video-note/server/venv/bin/python")
            .addText((t) =>
                t.setPlaceholder("~/obsidian-video-note/server/venv/bin/python")
                    .setValue(this.plugin.settings.pythonPath)
                    .onChange(async (v) => { this.plugin.settings.pythonPath = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("服务脚本路径")
            .setDesc("本地服务 main.py 的完整路径")
            .addText((t) =>
                t.setPlaceholder("~/obsidian-video-note/server/main.py")
                    .setValue(this.plugin.settings.serverScript)
                    .onChange(async (v) => { this.plugin.settings.serverScript = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("笔记保存文件夹")
            .setDesc("vault 内保存视频笔记的文件夹，不存在会自动创建")
            .addText((t) =>
                t.setPlaceholder("视频笔记")
                    .setValue(this.plugin.settings.saveFolder)
                    .onChange(async (v) => { this.plugin.settings.saveFolder = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("重排引擎（整理笔记用哪个大模型）")
            .setDesc("Claude Code / Codex CLI 走各自订阅额度；API 模式按量付费")
            .addDropdown((d) =>
                d.addOption("claude_cli", "Claude Code CLI（订阅）")
                    .addOption("claude_api", "Claude API Key（按量）")
                    .addOption("codex_cli", "Codex CLI（订阅）")
                    .addOption("openai_api", "OpenAI API Key（按量）")
                    .setValue(this.plugin.settings.claudeMode)
                    .onChange(async (v) => {
                        this.plugin.settings.claudeMode = v as "claude_cli" | "claude_api" | "codex_cli" | "openai_api";
                        await this.plugin.saveSettings();
                    }));

        new Setting(containerEl)
            .setName("Claude API Key")
            .setDesc("仅 Claude API 模式需要，形如 sk-ant-…")
            .addText((t) => {
                t.setPlaceholder("sk-ant-…")
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (v) => { this.plugin.settings.apiKey = v.trim(); await this.plugin.saveSettings(); });
                (t.inputEl as HTMLInputElement).type = "password";
            });

        new Setting(containerEl)
            .setName("Claude 模型")
            .setDesc("如 claude-sonnet-4-20250514（CLI 模式可用 --model 覆盖）")
            .addText((t) =>
                t.setValue(this.plugin.settings.claudeModel)
                    .onChange(async (v) => { this.plugin.settings.claudeModel = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("OpenAI API Key")
            .setDesc("仅 OpenAI API 模式需要，形如 sk-…")
            .addText((t) => {
                t.setPlaceholder("sk-…")
                    .setValue(this.plugin.settings.openaiApiKey)
                    .onChange(async (v) => { this.plugin.settings.openaiApiKey = v.trim(); await this.plugin.saveSettings(); });
                (t.inputEl as HTMLInputElement).type = "password";
            });

        new Setting(containerEl)
            .setName("OpenAI 模型")
            .setDesc("如 gpt-4o-mini / gpt-4.1（Codex CLI 模式通常无需改，走其默认模型）")
            .addText((t) =>
                t.setValue(this.plugin.settings.openaiModel)
                    .onChange(async (v) => { this.plugin.settings.openaiModel = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("Whisper 模型")
            .setDesc("tiny/base/small/medium/large-v3。越大越准越慢，中文建议 medium")
            .addDropdown((d) =>
                d.addOption("tiny", "tiny（最快）")
                    .addOption("base", "base")
                    .addOption("small", "small")
                    .addOption("medium", "medium（推荐）")
                    .addOption("large-v3", "large-v3（最准最慢）")
                    .setValue(this.plugin.settings.whisperModel)
                    .onChange(async (v) => { this.plugin.settings.whisperModel = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("笔记附带原始旁白")
            .setDesc("在笔记末尾追加完整的带时间戳旁白")
            .addToggle((t) =>
                t.setValue(this.plugin.settings.includeRaw)
                    .onChange(async (v) => { this.plugin.settings.includeRaw = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("frontmatter 标签")
            .addText((t) =>
                t.setValue(this.plugin.settings.tags)
                    .onChange(async (v) => { this.plugin.settings.tags = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("抖音/小红书 Cookie")
            .setDesc("浏览器登录对应平台后，在开发者工具里复制 Cookie 粘贴到这里（分号分隔，如 k1=v1; k2=v2）。B站无需填写。")
            .addTextArea((t) =>
                t.setPlaceholder("odin_tt=xxx; passport_csrf_token=yyy")
                    .setValue(this.plugin.settings.cookies)
                    .onChange(async (v) => { this.plugin.settings.cookies = v.trim(); await this.plugin.saveSettings(); }));
        (containerEl.querySelector("textarea") as HTMLTextAreaElement)?.setAttribute("rows", "3");

        new Setting(containerEl)
            .setName("自动拉起本地服务")
            .setDesc("插件加载时自动启动本地 Python 服务（失败会提示）")
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoStartServer)
                    .onChange(async (v) => { this.plugin.settings.autoStartServer = v; await this.plugin.saveSettings(); }));
    }
}
