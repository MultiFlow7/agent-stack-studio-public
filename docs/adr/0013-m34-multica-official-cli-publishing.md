# ADR 0013：M34 通过 Multica 官方 CLI 发布 Agent

- 状态：已接受，M34 真实 GUI/CLI 发布验收已完成
- 日期：2026-08-23
- 依据：ADR 0009、ADR 0011、ADR 0012、Multica v0.4.32 与上游提交 `1cc46b2`

## 背景

M34 必须把本地 Contract Test 目标替换为真实 Multica `validate/publish/status`，同时让 GUI 与 CLI 发布同一冻结 `.agent-stack` Version、payload 和内容哈希。Studio 不能读取或保存 Multica Token，也不能在官方能力不存在时伪造成功。

对 Multica 官方仓库进行只读核验后确认：

- v0.4.32 提供 `multica version --output json`、`runtime list --output json` 和 `agent list|get|create|update --output json`；Agent 创建必须指定 `runtime_id`。[CLI and daemon guide](https://github.com/multica-ai/multica/blob/main/CLI_AND_DAEMON.md)、[Agent CLI source](https://github.com/multica-ai/multica/blob/main/server/cmd/multica/cmd_agent.go)
- `multica login` 支持浏览器 OAuth 或 PAT，并把认证保存在 Multica 自己的配置中。Studio 可以复用官方 CLI 认证，不需要接触 Token。[Authentication source](https://github.com/multica-ai/multica/blob/main/server/cmd/multica/cmd_auth.go)
- Daemon 将本机 CLI 注册为具体 Runtime；Pi 与 OpenClaw 都是官方识别的 provider。Agent 绑定 Runtime，而不是上传一个独立可执行包。[Daemon and runtimes](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/daemon-runtimes.mdx)
- Agent create/update API 没有公开的调用方幂等键，也没有独立 Agent Version 资源。服务端工作空间内 Agent 名称唯一；Agent instructions 可以保存 Studio 的不可见版本标记。

## 决策

1. 真实目标固定为 `studio://publishers/multica-cli`，最低支持 Multica CLI v0.4.32。Connector 使用无 shell 参数数组调用官方 JSON 命令，并执行取消、超时、输出上限和错误脱敏。
2. GUI 与 CLI 继续由同一 `PublishService`、`buildPublishPackage` 和 SQLite `PublishRepository` 工作。冻结项目 Version 是 payload 的唯一配置来源；SQLite 只保存本机 Receipt、远端身份映射和项目 Version 引用。
3. 发布包使用递归键排序的规范 JSON 计算 SHA-256。包只包含 Agent 元数据、冻结 Profile、Harness、组件能力摘要和版本溯源；排除本地路径、Keychain、聊天、Experiment、Run 日志与 Artifact。只发布已启用且明确批准的 MCP，secret reference 名称和值都不进入 payload。Native Harness 包只声明 `nativeHost` 与 Runtime 管理的网络边界，不伪造 Cordis 依赖；历史 Studio Runtime 包仍可保留 Cordis 声明。
4. Prompt 原生写入 Multica instructions。Markdown Memory 与 Skill 以确定性标题编译进 instructions。MCP 转为官方 `mcp_config`；Studio `toolPolicy` 没有同构远端字段，显示为降级，实际权限由 Runtime 管理。
5. instructions 首行写入 `<!-- agent-stack-studio:<version-id>:<content-hash> -->`。`status` 必须通过真实 `multica agent get` 读取该标记并比较 hash；本地 Receipt 不能替代远端状态。
6. 首次发布先 `agent list` 按内容 hash 查找已存在身份，再检查同名冲突，最后调用 create。若 create 响应丢失或并发请求遭遇唯一名称冲突，重试再次按 hash 找回远端身份。已有本地映射只允许 update；映射远端消失时拒绝自动 create，避免重复身份。
7. 真实发布默认创建私有 Agent。扩大 Multica 可调用范围必须是未来独立、明确的权限操作，不能由 Studio 发布默认值隐式完成。

## GUI / CLI / Core / 事实 / 验收

- GUI：发布页列出官方 CLI 返回的在线 Runtime，显示字段级预检、payload hash、主动确认、远端 hash 状态和本机历史。
- CLI：`studio publish runtimes|validate|publish|status`；首次发布使用 `--runtime-id`，真实写入必须显式 `--confirm`，`--json` 保持稳定 envelope 和 40–45 类退出码。
- Core：同一纯函数生成 payload/hash；同一 PublishService 执行预检、幂等、远端核对与 Receipt。
- 项目事实：`.agent-stack` Version 不因发布而改变。SQLite 保存双方身份映射、attempt、幂等键、hash 和 Receipt；聊天历史仍只在 `.agent-stack-local`。
- 验收：fake executable 只验证官方命令契约与故障恢复，不能算真实发布成功。真实成功必须由安装并登录的官方 Multica CLI、在线匹配 Runtime、真实 create/update/get 响应和保存 Receipt 共同证明。

## 真实验收结果

用户已授权直接下载官方 Multica CLI。macOS arm64 v0.4.32 release 按官方 SHA-256 `27aea9925984f4343771bc03df9611df3c5fea658126514528412fffdee2ff63` 校验后安装到标准用户目录 `~/.local/bin`；Studio executable discovery 也覆盖 App 精简 PATH 下的该位置。现有 Multica 原生登录态和在线 Pi Runtime 由 CLI 只读确认，Studio 未读取配置文件或 Token。

`npm run test:e2e:multica-real` 使用独立临时 `.agent-stack`、临时 SQLite 和私有远端 Agent 完成真实 validate、首次 create、相同 Version/hash 重试、`agent get` status。结果为 validation ready、首次 Receipt succeeded、重试 `reused:true`、同一远端身份、local/remote content hash 完全相同；发布包结构化排除了 local-paths、keychain-secrets、experiment-data、chat-history、run-logs 和 artifacts。证据只保存远端 ID 的 SHA-256 指纹，不保存 Runtime/工作区/本机身份、路径、凭证、Prompt、响应、聊天或日志。

2026-08-24 的最终 arm64 打包验收中，GUI 在同一临时项目上冻结 Version 1，展示发布范围与 payload hash，明确确认后通过官方 Multica CLI 创建私有 Agent，并从真实 `agent get` 获得 `in-sync`。随后 App 内 CLI 对同一 Version 重试，返回 `reused:true`，且 GUI hash 前缀、CLI 本地/远端 payload hash 和 Receipt 远端身份全部一致。

`STUDIO_PACKAGED_EXTERNAL_ACCEPTANCE=1 npm run test:e2e:packaged-external` 输出 `PACKAGED_EXTERNAL_GUI_MULTICA VERIFIED`、`PACKAGED_EXTERNAL_CLI_MULTICA_REUSE VERIFIED` 和总结 `PACKAGED_EXTERNAL_E2E VERIFIED`。Git ignored 脱敏证据只保留 Version/payload hash、远端 ID 指纹、幂等和 Doctor 状态；不含本地路径、凭证、Runtime/工作区/本机身份、Prompt、回复、聊天或日志。M34 本身已完成；Developer ID、公证和独立无开发环境 Mac 属于 M37 外部分发门禁。
