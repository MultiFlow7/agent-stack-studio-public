# 术语表

| 术语 | 定义 |
| --- | --- |
| Coding Agent | 调研、下载仓库、修改代码并调用 Shell 的外部工具或人，例如 Codex、Claude Code、Cursor、自建 Agent、CI 或人工 Shell。它不等于 Stack 的运行时控制器。 |
| Studio Core | GUI 与 CLI 共用的厂商无关领域层，负责项目读写、静态导入、组合、Owner、验证、并发和版本冻结。 |
| `.agent-stack` | 项目级、版本化 JSON 文件。它是可移植 Component、Stack、Owner 和 Version 定义的唯一可编辑事实来源。 |
| Agent Stack Package | `*.agent-stack-package.json` 可移植导出包。它封装经审计的 `.agent-stack`、排除清单和包级 SHA-256，不包含 Keychain 密钥或 SQLite 本机记录。 |
| Studio CLI | `studio` Shell 命令。任何 Coding Agent 均可调用，不含厂商专用协议。 |
| Agent Loop | Stack 内由循环控制器驱动模型、工具和上下文的运行时模式。 |
| Workflow | Stack 内由结构化流程控制节点的运行时模式。 |
| Hybrid | Workflow 与 Agent Loop 显式交接控制权的运行时模式。 |
| External Harness | Pi、OpenClaw 或自研项目等外部运行时控制模式。它不是外部 Coding Agent。 |
| Descriptor | Component 的能力、依赖、兼容性和来源声明。它不是执行权限。 |
| Owner | 一个 Stack 中对某项能力唯一负责的 Component。重叠时必须显式选择。 |
| Version | 从通过验证的项目 revision 创建的不可变快照。相同内容重复冻结会复用已有版本。 |
| SQLite 本机索引 | 保存项目路径、运行/实验/发布记录、路径映射、Keychain 引用、偏好和维护记录的本机数据库，不复制 `.agent-stack` 可编辑内容。 |
| Source Discovery Provider | 把远端公开来源映射为厂商无关候选元数据的接口。M8 的首个 Adapter 是 GitHub。 |
| provider-reported | 远端 Provider 报告的仓库元数据，仅供筛选，不代表 Studio 已核验许可、兼容性或安全性。 |
| 下载交接 | 包含仓库来源、目标目录和必须审阅的命令参数数组的数据对象。Studio 生成但不执行它。 |
| 默认拒绝 | Electron Session、WebContents、IPC 与 CSP 在没有明确产品决策时拒绝权限、下载、导航、第三方嵌入或远程调用来源。 |
| 发布完整性清单 | 与应用版本和架构绑定的 SHA-256 文件，覆盖同次构建的 DMG 与 ZIP；用于发现损坏或篡改，不代表签名或公证。 |
| Project Integrity Report | Studio Core 对 `.agent-stack` 不可变 Version 快照重新计算 SHA-256 后生成的结构化报告；证明内部一致性，不证明作者身份。 |
| Keychain 引用 | SQLite 中保存的服务、账户、用途和 Agent 关系；密钥原文只存在于当前 Mac 的登录钥匙串。 |
| 打包应用 E2E | 实际启动最终 `.app`，检查 Renderer 安全边界、中文工作流并生成截图的自动化冒烟；不等于签名或公证。 |
| 本地可信执行 Profile | Studio 自带、版本固定的四模式执行描述和步骤，只接受精确白名单 Adapter，用于验证本地 Runtime、Run 与 Experiment 闭环。 |
| Runtime Adapter 白名单 | 由 Main 与 Runtime 共用的完整 Adapter 引用集合。命名空间前缀、静态 Descriptor 或用户确认均不会自动进入白名单。 |
| declared | Manifest 明确声明，尚未由 Studio 运行验证。 |
| detected | Studio 从安全静态证据推断，需要用户检查。 |
| user-confirmed | 用户或 Coding Agent 明确更正并确认 Descriptor。 |
| contract-tested | 稳定 Component Contract 已通过测试。 |
| runtime-verified | 受信环境中的最小运行验证已通过。 |
