# ADR 0021：Agent 构建中的模型与本机认证

- 状态：已接受，适用于 Native-first Agent 构建路径
- 日期：2026-08-26
- 依据：ADR 0007、0011、0012、0015、0017、0020

## 背景

现有 Native Harness probe 只证明受支持 CLI 的存在与版本，通用密钥引用也没有接入 Pi、OpenClaw 或 Codex 的真实模型调用。界面因此可能把“CLI 可执行”或“Keychain 条目存在”写成完整可运行，并允许只通过 Stack 校验的草稿被冻结。

普通用户需要在 Agent 构建主流程中选择 Harness、Provider、模型和认证方式，完成一次由用户主动触发的最小模型调用后再冻结。该能力不能扩大 Renderer 权限，不能复制第三方 OAuth token，也不能让 API Key 进入项目、数据库、参数、日志或发布内容。

## 决策

1. `.agent-stack` 与 Agent Version 只保存可移植的 `modelConfiguration`：Provider、模型和凭证需求。Keychain locator、认证方式的本机绑定、检查时间、失败与最小调用结果只属于本地事实。
2. SQLite 以 Provider credential binding 关联现有 `secret_references`，并以配置哈希保存脱敏验证结果。历史通用密钥引用不按名称猜测 Provider，继续作为未绑定的高级入口。
3. `SecretService`、`MacOsKeychainAdapter` 和 `MacOsSecureInputPrompt` 是唯一 API Key 存储与输入路径。Renderer 只发起 allowlisted 动作，不接收原文、locator、可执行路径、参数或环境变量名。
4. Pi 0.84.2 的 API Key 只通过该 Provider 官方支持的单次子进程环境变量交付。Key 不进入 argv、配置文件或父进程环境。子进程使用最小环境；若输出中出现本次 Key，执行失败关闭且原始输出不跨边界。
5. Harness 官方订阅或 OAuth 只启动固定版本、固定入口的官方认证流程并检查状态。Studio 不读取、复制、回传或重新持久化第三方 token。已有登录也只通过官方状态命令识别。
6. OpenClaw 与 Codex 只开放固定版本已经证实的认证方法。无法在不写第三方明文配置或不绕过官方边界的路径精确降级，不能显示为可用方法。
7. “验证模型连接”是一项用户主动操作。界面必须先说明可能产生少量模型调用费用；后台 probe、状态刷新和 Doctor 都不得触发收费调用。
8. Agent readiness 是共享 Core/Service 派生事实，同时要求 Stack/兼容性通过、Harness 可执行、当前 Provider/模型认证有效、相同配置哈希的最小模型调用成功。Codex simulation 永远不能满足真实 Provider 认证或冻结前置条件。
9. Harness、Provider、模型、认证方式或 API Key 变化会立即使旧验证失效。失败状态区分无效或过期凭证、模型无权限、网络失败与用户取消，并给出直接恢复动作。
10. GUI 与 CLI 使用相同配置、binding、readiness 与 verify 服务。CLI 密钥原文只从 stdin 进入；机器 JSON 不包含原文、locator、第三方输出或 token。
11. Provider capability 分别声明推荐模型与自定义模型 ID 能力。推荐目录用于发现和默认值，不是封闭 allowlist；仅当固定 Harness 的显式模型参数边界支持时，才允许保存经过格式校验的自定义 ID。新 ID 必须使旧验证失效，并通过真实最小模型调用才能产生就绪事实。

## 安全与验收

- 所有模型认证 IPC 输入输出使用严格 Zod Schema、Sender allowlist 和单航班/取消边界。
- Keychain 只在 Main 或 CLI 受信边界解析；Renderer、SQLite、项目、Version、Run、Manifest、Artifact、日志、备份、恢复、导出和发布 payload 都不得含原文。
- Host Driver 测试必须证明真实 Key 不在 argv、配置与输出，不继承无关父进程凭证，并覆盖回显失败关闭。
- 冻结服务必须返回结构化 blocker 与恢复动作，不能只提示用户手动打开终端。
- 无真实 Provider 凭证时，自动化可以关闭本地安全与失败路径，但不得把 fixture、probe 或 Codex simulation 记为真实模型认证成功。

## 后果

Agent 构建获得完整的模型认证闭环，同时保留 Native-first、macOS Keychain 和单一便携事实源。代价是各 Harness 的认证能力不对称，Studio 必须维护固定版本的 capability contract，并对未证实路径明确降级。
