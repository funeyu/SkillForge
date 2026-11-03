# SkillForge 0.0.2

- 新增自包含安装器：安装技能后可通过 `setup` 或首次 `read` 自动准备桌面应用，优先复用已有安装。
- 自动下载并校验安装包，检查依赖、离线 Base 语音模型及独立语音运行时，无需另行安装 Python。
- 安装过程显示下载进度与耗时状态；校验失败清理临时文件，不覆盖已有应用或配置。
- 新增英文 README、首页截图及详细使用与开发指南，完善技能安装说明。

## 下载与安装

- `SkillForge-0.0.2-macos-arm64.dmg`：macOS Apple Silicon 安装包，打开后将应用拖入「应用程序」。
- `SkillForge-0.0.2-macos-arm64.zip`：同一应用的 ZIP 压缩包。
- `SHA256SUMS.txt`：安装包 SHA-256 校验值。

此版本未进行 Apple Developer ID 签名或公证，只有本地 ad-hoc 签名；首次打开可能被 macOS 拦截，请确认下载来源后按「系统设置 → 隐私与安全性」中的提示允许打开。暂未提供 Intel Mac、Windows 和 Linux 安装包。

桌面应用负责网页读取和展示，Skill 提炼仍由当前 Agent 完成。将技能入口安装到 Agent 需要 Node.js 22.12+：

```sh
node /Applications/SkillForge.app/Contents/Resources/app/scripts/agent.cjs install-skill
```

源码中的大模型文件通过 Git LFS 存储。GitHub 自动生成的源码 ZIP 不包含实际模型；请使用 Git LFS 克隆源码，或下载上述已包含完整模型的安装包。
