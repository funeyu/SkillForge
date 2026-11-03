# SkillForge 内置语音模型

`base/` 是实际随工作区保存的 faster-whisper Base 多语言模型文件，不是符号链接。

- 来源：Systran/faster-whisper-base，转换自 OpenAI Whisper Base。
- 固定版本：`ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66`。
- 许可：MIT，来源信息与模型说明保留在 `base/README.md` 和 `manifest.json`。
- 来源为现有 openMV 内置模型的本地副本；运行时不读取 openMV。
- 校验：在 SkillForge 执行 `npm run check:speech-model`。清单中的 SHA-1 为 Git blob 哈希，SHA-256 为文件内容哈希。
- 加载：`services/speech-worker.py` 仅加载此目录的本地文件，强制禁用模型联网下载及遥测。

模型本身不包含 Python 推理环境；使用 `npm run prepare:speech` 创建独立运行时。
