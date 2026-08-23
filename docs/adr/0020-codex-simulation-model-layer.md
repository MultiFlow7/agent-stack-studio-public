# ADR 0020：Pi/OpenClaw 的 Codex 模拟模型层必须显式、隔离且仅用于测试

- 状态：已接受，M33 验收阶段已实施
- 日期：2026-08-23
- 依据：ADR 0011、ADR 0012、用户对 Pi/OpenClaw 下载与 Codex 模拟测试的明确授权

## 背景

Pi 与 OpenClaw 的 Host Driver 必须用真实上游二进制和原生 CLI 契约验收，不能用 fixture 冒充。但用户当前不要求部署本地模型，并明确要求先复用已认证的 Codex 作为模拟模型层。直接复制 Codex OAuth 文件、把模拟结果记录成 Harness 原生 Provider 成功，或让测试配置污染用户的 Pi/OpenClaw 状态，都违反认证与证据边界。

Codex CLI 的稳定非交互入口是 `codex exec`。它支持 JSONL 输出、`--ephemeral`、`--ignore-user-config`、`--ignore-rules` 和 `--sandbox read-only`，适合在本机 loopback 代理后提供受控的 OpenAI-compatible 测试响应。

## 决策

1. 模拟层默认关闭。只有同时设置 `STUDIO_CODEX_SIMULATION=1` 和带明确端口的 `http://127.0.0.1|localhost|[::1]/v1` endpoint 才能启用；HTTPS、远端主机、URL 凭据、查询参数和非 `/v1` 路径全部拒绝。
2. 代理只监听 loopback，要求固定的进程内测试凭据，限制请求/响应大小与单请求并发。它不记录 Prompt、响应、stderr、认证值或工作目录。
3. 每次模型请求通过无 shell 参数数组调用 `codex exec --json --ephemeral --ignore-user-config --ignore-rules --sandbox read-only`，Prompt 从 stdin 传入，工作目录是新建的空临时目录；结束时删除临时目录。
4. Pi 使用独立 `PI_CODING_AGENT_DIR` 与固定 `models.json`，OpenClaw 使用独立 `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH`。两者均禁用 Harness 工具，不读取或覆盖用户默认配置，也不复制 `~/.codex/auth.json`。
5. 运行结果必须写入 `modelLayer.kind = codex-simulation`，GUI 显示“不代表 Harness 原生 Provider 认证”，降级列表同样声明边界。旧历史没有该字段时继续兼容读取。
6. 自动证据只保存 Harness/版本、run/chat 状态、项目 revision/hash、模型层标记和固定验收标记是否匹配；本地路径、凭证、Runtime/工作区身份、Prompt、响应正文、聊天与日志都不进入仓库或公开快照。

## 验收结果

在真实 Pi `0.84.2`、OpenClaw `2026.1.30` 和 Codex CLI `0.148.0-alpha.9` 上，`npm run test:e2e:codex-simulation` 已完成 Pi run/chat 与 OpenClaw run/chat 四条 Studio CLI/Core 路径，输出 `CODEX_SIMULATED_HARNESS_E2E VERIFIED`。这证明真实 Harness 原生入口、配置隔离、JSON 解析、聊天/单次运行和 Studio 事实闭环；它不证明 Pi/OpenClaw 自有 Provider 登录。

## 后果

M33 可以在不部署本地模型、不扩散模型凭证的前提下先验证真实 Harness 集成，并且证据不会混淆模型来源。最终分发若要求 Harness 原生 Provider 认证或真实会话续接，仍需在对应 Harness 的原生登录流程中单独验收；Codex simulation 不能替代该证据。
