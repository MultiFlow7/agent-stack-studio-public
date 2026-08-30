# ADR 0015：M36 第三个 Harness 选择 Codex CLI

- 状态：已接受，M36 实施中
- 日期：2026-08-23
- 依据：ADR 0011、ADR 0012、M36 第三个真实 Harness 验收、Codex CLI 官方契约

## 背景

M36 需要第三个可重复验证的真实 Harness。ADR 0012 将 DeepSeek Harness 保留为候选，但它截至该决策的普通用户安装路径仍依赖未发布的 Multica bridge，自动 checkout/build 又违反未知第三方代码默认不执行的边界。第三个 Harness 必须具备可固定版本、非交互调用、结构化输出、明确权限和真实本机 Smoke 路径。

Codex CLI 官方 reference 将 `codex exec` 定义为脚本/CI 的非交互入口，并公开 JSONL、resume、工作目录与沙箱选项。当前开发机的 ChatGPT 应用携带 `codex-cli 0.148.0-alpha.9`，真实执行 `codex exec --json --sandbox read-only --ephemeral` 已返回结构化 thread、agent message 和 usage。[Codex CLI reference](https://developers.openai.com/codex/cli/reference/)

## 决策

1. M36 第三个 Harness 采用 Codex CLI，并将当前受支持版本精确固定为 `0.148.0-alpha.9`。其他版本只 probe，不执行，待契约重新验证后显式升级。
2. 非交互 Run 使用 `codex exec --json --ephemeral`；Chat 第一次执行保存 `thread.started` ID，后续用 `codex exec resume --json` 续接。Studio 自己的 session UUID 仍是 GUI/CLI 稳定身份。
3. Driver 固定隔离用户与项目隐式规则：`--ignore-user-config --ignore-rules --skip-git-repo-check`。`read-only` 与 `workspace` 工具策略分别映射为 Codex 的 `read-only` 与 `workspace-write` 沙箱，不开放 danger-full-access。
4. 能力矩阵为：Prompt native、session native、Skill adapted、Markdown Memory adapted、MCP unavailable。Profile 适配内容显式加入当前请求；MCP 不读取用户配置、不复制凭证、不静默执行。
5. Chat thread 映射和 Native Run 历史只保存在 `.agent-stack-local`，权限为 `0600`，不会进入项目版本或 Multica payload。Renderer 仍不能提交 executable、argv、cwd、认证或配置文件。

## 验证与失败语义

- 契约测试覆盖精确版本 probe、JSONL `thread.started` / `item.completed` / `turn.completed` 解析、Chat resume、Run ephemeral、沙箱和 token 用量。
- 真实 Studio CLI E2E 创建临时 `.agent-stack`、选择 Codex、执行非交互 Run，获得精确回复 `M36_OK`、`succeeded` 状态、项目 revision/hash 与 usage，并从 `run list` 读回同一结果。
- 未安装、版本漂移、认证失败、取消、超时、非零退出和缺少 agent message 均失败关闭。stderr 只通过既有脱敏错误边界，不进入可移植项目。

## 后果

M36 获得第三个真实且本机已完成成功调用的 Harness，不需要执行未知仓库代码。代价是 Codex 的 Studio Skill/Memory 当前是 Prompt 适配，MCP 暂不可用；这种不对称由能力矩阵和每次结果的 degradation 明确表达。DeepSeek Harness 保留为未来候选，不在可安装 bridge 成立前宣称支持。
