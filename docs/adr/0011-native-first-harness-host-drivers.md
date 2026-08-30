# ADR 0011：Native-first Harness Host Driver 与普通用户产品边界

- 状态：已接受，适用于 M32 起的新产品路径
- 日期：2026-08-23

## 背景

M0–M31 证明了本地 Electron、Studio Core、`.agent-stack`、revision、原子写入、兼容证据和独立 Runtime 子进程，但默认产品仍围绕科研 Experiment、Owner、Workflow 和通用 Runtime Adapter 展开。四种执行模式都经过 Studio 内置 Cordis Profile，真实 Harness 只以静态项目或 fixture 契约出现，用户无法在 Studio 中使用真实 Harness 聊天并发布到 Multica。

当前目标用户已经具备基础 Agent 概念，但不会写代码。他们需要先选择真实 Harness，再添加 Prompt、Skill、Markdown Memory、MCP Tool 等能力，聊天或单次运行，最后发布。要求所有 Harness 先转换成统一 Cordis Service 会遮蔽原生能力、扩大适配成本，并形成并不存在的通用运行协议。

## 决策

1. 产品采用 Native-first。每个受支持 Harness 由版本化 `HarnessHostDriver` 调用其公开且可验证的原生 CLI、SDK 或进程协议。Driver 负责能力声明、安装检测、配置编译、聊天、非交互运行、取消、Smoke Test、诊断和脱敏。
2. Cordis 不再是所有 Harness 的统一必经运行层。它只保留在 Studio 自有 Runtime 内核、需要依赖注入/生命周期组合的内置能力和旧 Version 的兼容读取边界。Cordis 类型仍不得进入领域模型、`.agent-stack`、IPC 或 Renderer。
3. 一个 Agent 选择一个主要 Harness。Prompt、Skill、Memory、MCP Tool 等 Component 通过 Harness Capability Matrix 编译为原生配置；跨 Harness 不支持的能力必须得到明确的 native/adapted/degraded/unavailable 结论。
4. `StudioCore` 是 GUI 与 CLI 的共同应用内核。Core 管理 `.agent-stack`、revision、原子写入、冻结版本、安装计划、Host Driver 请求和内容哈希；Electron Main 与 CLI 只提供操作系统、进程、Keychain 和交互适配。
5. 人类 `chat` 可以交互；Agent/CI `run` 必须非交互并保持稳定 JSON envelope、退出码、幂等键和取消语义。聊天记录属于本机事实，不进入 `.agent-stack` 或发布包。
6. 真实执行只允许版本固定、代码内注册并通过契约测试的 Host Driver。未知第三方项目不执行；已知项目只能走固定安装方案，未知项目只生成完整 Markdown 定制任务。
7. 发布只接受冻结 Version。GUI 与 CLI 从同一 Version 物化完全相同的 Multica payload 和内容哈希；本地路径、密钥、聊天、Run 日志和 Artifact 不进入 payload。

## 对既有 ADR 的影响

- ADR 0001、0003、0004、0005、0006、0007、0009、0010 的本地优先、共享 Core、项目事实、安全、完整性、Keychain、迁移与证据边界继续有效。
- 本 ADR 取代 ADR 0002 中“所有已验证 Stack 编译为 Cordis Runtime Plan”的强制性解释，也取代 ADR 0008 将四种 Studio 内置 Profile 作为新执行路径的产品默认。旧 Runtime Profile 继续只读或用于迁移/历史复现，不再约束新 Harness。
- Owner、完整 Descriptor、runtimeAdapter、Receipt、Workflow 与 Experiment 不删除；它们降级为高级证据、历史读取或迁移事实，不在普通路径中要求用户操作。

## 安全与验收

- Driver 进程使用参数数组、固定入口、受控 cwd/env、超时、输出上限、AbortSignal 和有界强制清理；stdout/stderr 在跨边界前解析并脱敏。
- 密钥原文只在 Main/CLI 受信边界从 Keychain 读取，不进入 argv、Renderer、项目、聊天导出、日志或机器错误。
- 每个 Driver 必须有 Manifest、能力矩阵、安装检测、真实 Smoke Test、取消/超时/错误/脱敏测试，以及 GUI/CLI 共核验收。
- 新增网络、文件、安装或执行权限时仍按 AGENTS.md 先沟通；不得以 Native-first 绕过默认拒绝。

## 结果

Studio 可以保留 M31 已验证的项目与安全基础，同时让真实 Harness 保持原生能力和升级路径。代价是每个 Harness 都需要明确 Driver 和能力矩阵，不能依靠一个抽象运行协议自动获得广泛兼容；该代价与产品“少量真实支持优于大量虚假兼容”的方向一致。
