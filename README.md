# SkillForge

由 AI 智能体驱动的网页转技能工具。<br />
一个网页，一次提炼，一个可复用的 Skill。

[English](README.en.md) · **简体中文**

## 简介

SkillForge 让你的编程智能体把网页里的知识，变成下次能直接使用的技能。

把一篇教程、一份文档或一段操作指南交给 Codex、Claude Code 等智能体。SkillForge 打开网页，读取正文；当前智能体把内容提炼成操作指令，桌面的三维锻造台显示任务阶段。完成后，Skill 会保存到本地工具箱，并默认安装到你的智能体。

- **一个网页。** 给出 URL 就能开始。遇到登录或验证，在独立窗口里完成操作，智能体会继续等待正文，不需要复制粘贴整篇文章。
- **一次提炼。** 不是只做一份摘要，而是整理出用途、触发条件和操作步骤。分析由你正在使用的智能体完成，不用再给 SkillForge 配置模型地址或 API Key。
- **一个可复用的 Skill。** 生成标准的 `SKILL.md`，保留来源信息，安装到 Codex、Claude Code 或自定义技能目录。同名技能不会被覆盖，安装失败也不会丢失结果。

![SkillForge：三维锻造台、网页输入框与本地技能工具箱](docs/images/skillforge-home.png)

## 安装

需要 Node.js 22.12 或更高版本。macOS Apple Silicon 可通过技能入口自动安装桌面应用、依赖及语音运行时：

```sh
npx skills add funeyu/SkillForge --skill skillforge
```

skills CLI 负责复制技能，不运行应用安装钩子。安装后让智能体「安装并初始化 SkillForge」，或首次使用技能，入口会自动下载桌面应用（含 Electron、依赖、语音模型和独立语音运行时），显示下载百分比/字节数、校验、解压和语音自检进度，并自动绑定路径；无需手动配置 `runtime.json` 或安装 Python。也可立即执行：

```sh
node "<skills CLI 输出的 Skill 安装目录>/scripts/skillforge.cjs" setup
```

默认安装到 `~/Applications/SkillForge.app`，优先复用已有应用；只有语音自检通过才报告就绪。详细说明见[安装配置](docs/guide.zh-CN.md#安装到-agent)。

也可以从 [Releases](https://github.com/funeyu/SkillForge/releases/tag/0.0.2) 下载 0.0.2 桌面版，提供 macOS Apple Silicon 的 DMG 和 ZIP。它自带语音模型和独立语音运行时，不用另外安装 Python；暂未提供 Intel Mac、Windows 和 Linux 安装包。

将应用放入「应用程序」后，可以直接用它自带的安装器安装技能入口，并自动绑定路径（与上面的方式任选其一，不要重复安装）：

```sh
node /Applications/SkillForge.app/Contents/Resources/app/scripts/agent.cjs install-skill
```

默认安装到 Codex；Claude Code 在命令末尾添加 `--agent claude`，其他目录使用 `--skills-dir`。应用尚未进行 Apple Developer ID 签名和公证；确认下载来源后，按「系统设置 → 隐私与安全性」中的提示允许打开。

然后重新加载智能体会话，对它说：

> 使用 SkillForge，把这个网页做成可复用的 Skill：网页 URL。

它会打开 SkillForge，读取网页并开始提炼。需要登录时，在读取窗口完成操作，点击「登录完成，重新读取」即可；不需要再回到聊天里通知智能体。单独打开桌面应用不会自行调用模型，仍需当前智能体完成分析。

## 命令

这些命令由你的智能体来运行，也可以在源码目录里自己运行。安装后的技能入口使用 `node "<技能目录>/scripts/skillforge.cjs" <命令>`，并自动沿用安装时的智能体与目录配置。

```sh
node scripts/agent.cjs help
node scripts/agent.cjs read 'https://example.com/article'
node scripts/agent.cjs status <任务ID> --wait 120
node scripts/agent.cjs pending
node scripts/agent.cjs publish <任务ID> --file result.json
node scripts/agent.cjs install <任务ID>
node scripts/agent.cjs cancel <任务ID>
```

`help` 列出命令与公共选项；`read` 创建读取任务；`status` 查询或等待任务；`pending` 列出未结束的任务。智能体生成结果后，用 `publish` 保存并默认安装；`install` 重试安装，`cancel` 取消任务。

`--agent codex|claude|generic` 选择目标智能体，`--skills-dir` 指定技能目录，`--data-dir` 指定数据目录。只想保存、不想安装时，为 `publish` 添加 `--no-install`。完整等待流程和结果格式见[Agent 工作流](docs/guide.zh-CN.md#agent-工作流)。

## 锻造台与工具箱

SkillForge 是在你电脑上运行的 Electron 桌面应用。三维锻造台用纸片流入、锻锤和成品动效展示任务阶段；你可以拖动或用方向键旋转视角，双击场景或按 Home 恢复。动效遵循系统的减少动态效果设置。

右上角的工具箱保存生成的 Skill。可以展开查看正文、网页来源和实际安装状态。即使目标目录没有写入权限，或遇到同名技能，生成结果也会留下来，解决问题后再安装即可。

任务和资料默认保存在 `~/.skillforge`。每份新技能都包含 `SKILL.md` 和 `source.json`，后者记录原始网址、最终网址、标题、读取时间和正文 SHA-256，方便回查来源。锻造台界面从本地加载，读取网页仍需要访问目标网站。

## 工作原理

一次锻造分成三步：桌面应用读取网页，当前智能体提炼内容，SkillForge 保存并安装结果。

```text
网页 URL → Electron 读取正文 → 当前智能体生成指令 → 工具箱 → 智能体技能目录
```

`read` 会启动或唤起 Electron，在隔离的浏览器会话里读取网页。遇到登录时等待用户操作，不读取密码，也不向智能体导出 Cookie。智能体持续等待同一个任务，直到取得 `awaiting_agent` 状态，再读取 `contentPath` 指向的非空正文；不会把登录页当成完成结果，也不会反复创建新任务。

智能体把网页当作待分析的资料，而不是要执行的指令，生成一个结果文件：

```json
{
  "name": "example-skill",
  "description": "这个技能的具体用途和触发条件",
  "content": "Markdown 操作指令正文，不含 frontmatter"
}
```

`publish` 补齐 frontmatter 和真实来源，保存到工具箱，再尝试安装。生成的技能不会自动执行，已有技能不会被覆盖。等待登录、正文校验、权限与失败处理的完整约定见 [`skills/skillforge/SKILL.md`](skills/skillforge/SKILL.md)。

项目还提供独立的[网页内容服务](docs/guide.zh-CN.md#网页内容服务)，用于文字提取和音视频播放识别。语音使用内置 Base 模型离线处理，不上传音频；这条服务链路与智能体的浏览器读取流程分开，不会自动转写每个网页里的媒体。

## 从源码运行

需要 Node.js 22.12 或更高版本，以及 Git LFS。语音模型由 Git LFS 管理，下载源码 ZIP 不包含实际模型。

```sh
git lfs install
git clone https://github.com/funeyu/SkillForge.git
cd SkillForge
git lfs pull
npm install
npm run dev
```

`npm run dev` 启用开发热更新；`npm start` 正常启动桌面应用。运行 `npm run install:skill` 会把技能入口安装到默认智能体，并自动绑定当前源码目录；安装到 Claude Code 使用 `npm run install:skill -- --agent claude`。

`npm run check` 检查 JavaScript 语法。需要音视频识别时，准备 Python 3.10+，运行 `npm run check:speech-model` 和 `npm run prepare:speech` 校验模型、安装推理依赖；仅文字读取不需要 Python。

在 macOS Apple Silicon 上运行 `npm run dist:mac` 构建安装包。热更新、服务 API、运行时配置与发布流程见[使用与开发指南](docs/guide.zh-CN.md)。

## 社区

提问、想法和使用反馈，欢迎发到 [Issues](https://github.com/funeyu/SkillForge/issues)。分享使用案例时，也欢迎说明你从什么资料中提炼了什么技能。

## 参与贡献

欢迎提交 Issue 或 Pull Request。报告问题时，请附上运行环境、复现步骤和相关日志，注意移除账号信息、Cookie 与其他敏感内容。开发前可先阅读[使用与开发指南](docs/guide.zh-CN.md)，提交代码前运行 `npm run check`。

## 许可证

仓库目前未提供项目级 `LICENSE` 文件。第三方依赖和语音模型的许可信息请参阅各自的声明；模型来源见 [`models/speech/README.md`](models/speech/README.md)。
