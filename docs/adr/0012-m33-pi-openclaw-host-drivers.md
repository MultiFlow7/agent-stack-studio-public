# ADR 0012：M33 选择 Pi 与 OpenClaw，并延后 DeepSeek Harness

> 2026-08-27 修订：本 ADR 的 Harness 选择与版本结论仍有效；Pi/OpenClaw 的 MCP 能力矩阵与执行边界已由 [ADR 0022](./0022-optional-capability-catalog-controlled-mcp-native-routing.md) 取代。

- 状态：已接受，M33 实施中
- 日期：2026-08-23
- 依据：ADR 0011、M33 Multica 发布能力核查、上游公开运行契约

## 背景

M33 需要至少两个真实、版本受控的 Harness Host Driver，并优先考虑 Pi 与 DeepSeek Harness；如果 Multica 的真实发布路径更适合 OpenClaw，可以记录依据后调整第二个 Harness。选择必须基于公开的真实入口和 M34 发布目标，不能用 fixture 或 Studio 旧 Harness X 代替。

上游核查得到以下事实：

- Pi 官方仓库提供 `@earendil-works/pi-coding-agent`，包含 CLI、Agent Runtime、状态和多模型 API；其设置文档公开 session directory 与 Skill 路径入口。Studio 固定支持 `0.84.2`，使用 JSON print、原生 session 和 Skill 参数。[Pi 官方仓库](https://github.com/earendil-works/pi-mono)、[Pi settings](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/settings.md)
- OpenClaw 官方 `agent` 契约提供 `--local`、`--session-id` 和 `--json`；新版 `agent exec` 是 CI/自动化推荐的隔离单次入口，稳定 JSON envelope 明确 usage、状态和退出码。[OpenClaw Agent CLI](https://docs.openclaw.ai/cli/agent)
- Multica 已在 2026-08-13 合入 DeepSeek Harness 一方 Runtime，包含 probe、session resume、MCP 注入和结构化事件；但它依赖单独的 DSH Multica profile bridge。[Multica PR #6923](https://github.com/multica-ai/multica/pull/6923)
- 截至本决策日期，外部/自托管用户需要的 `dsh-multica-runtime` 仍未作为可安装 npm 包发布，公开 issue 明确说明必须手工 clone、build 并以绝对路径安装，功能对普通外部用户实际上不可直接到达。[Multica issue #6936](https://github.com/multica-ai/multica/issues/6936)
- DeepSeek Harness 自身仍标注 Developer Preview，并警告会出现破坏性兼容变更。[DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)

## 决策

1. M33 的两个 Harness 选择 Pi 与 OpenClaw。Pi 固定为 `@earendil-works/pi-coding-agent@0.84.2`；OpenClaw 最低兼容 `2026.1.30`，并在检测到 `2026.7.1` 或更高版本时仅为非交互 Run 使用 `agent exec`。
2. Chat 和 Run 共享 `NativeAgentCore`、Host Driver registry、项目 Profile、取消/超时、输出上限、脱敏和本地历史。Chat 使用 Harness 原生 session；Run 不读取 TTY，并支持本地幂等键。
3. `.agent-stack` 保存 Prompt、Markdown Memory、Skill、MCP 引用、工具权限、Harness Component、revision 与冻结快照。聊天消息、回复、日志、模型凭证和进程输出只进入被 `.gitignore` 排除的 `.agent-stack-local`，不进入可移植项目或发布内容。
4. Pi 能力矩阵为：Prompt native、Skill native、Memory adapted、MCP unavailable、session native。Pi 0.84.2 没有本实现可以验证的稳定 MCP 注入入口，因此不得执行项目 MCP 配置。
5. OpenClaw 2026.1.30 能力矩阵为：Prompt/Skill/Memory adapted、MCP adapted、session native；Profile 被转换为显式消息上下文，工具权限沿用本机配置并显示降级。新版 `agent exec` 的 Prompt/隔离 Run 为 native；项目 MCP 仍只引用用户本机已配置服务，不复制凭证，也不把未批准配置写入 OpenClaw。
6. DeepSeek Harness 延后到 M36 第三个 Harness 候选。只有在可重复安装的公开 Multica profile、固定版本和真实 smoke 路径成立后才提升为正式支持；不从源码 checkout 自动执行或伪造发布兼容。

## 安全与失败语义

- Host Driver 使用无 shell 的参数数组启动精确 executable；进程组受超时、取消、硬终止和 stdout/stderr 上限约束。
- 未安装、版本不支持、认证缺失、执行失败、超时和取消分别进入稳定状态；认证错误只返回脱敏动作，不回传 stderr 原文。
- 未批准 MCP 不执行。Pi 的 MCP 明确不可用；OpenClaw 仅复用用户已配置的同名/环境能力，Studio 不写入密钥。
- 真实模型调用需要用户在对应 Harness 中已有授权。无授权机器只可完成版本/probe/失败路径验证，不得把它记为真实聊天成功。

## 后果

M33 获得两个可选择的真实 Host Driver 和面向 M34 的 OpenClaw 发布路径，同时避免依赖尚不能由普通用户安装的 DSH bridge。代价是能力矩阵并不对称，尤其 Pi MCP 和旧 OpenClaw Profile/工具权限必须明确降级；这是“少量真实支持优于统一但虚假的协议”的预期结果。
