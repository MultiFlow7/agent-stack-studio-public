# ADR 0022：可选能力目录、受控 MCP 与 Native 运行分流

- 状态：已接受
- 日期：2026-08-27
- 依据：ADR 0001、0005、0007、0011、0012、0018、0021，引导式创建、Native-first 和本地 MCP 纵向验收
- 取代：ADR 0012 中 Pi MCP unavailable、OpenClaw MCP adapted/复用同名本机配置的当前产品结论

## 背景

引导式创建已经把 Harness、Provider/模型和认证收敛到一条 Main 状态机，但完成门槛仍要求 Prompt、Skill、Memory 或 MCP 至少有一项非空。Renderer 只提供 Markdown 文本框和 HTTP URL，项目已有的固定 Skill 方案、组件目录和 MCP 配置无法被发现/选择。这会迫使用户填写无意义 Markdown，也会把“写了一段文本”误表述为“安装了能力”。

Profile schema 早已表达 stdio 与 HTTP MCP，但当时 Host Driver 的真实事实是 Pi/Codex 不消费它，OpenClaw 仅可能命中用户自行管理的同名配置。同时 `external-harness` Agent 的工作台仍暴露 legacy `runs:start`，导致 Pi 的 `studio://host-drivers/pi` 被送入只允许 Studio Runtime Adapter 的旧白名单，并把 Electron invoke 前缀泄漏到用户界面。

## 决策

1. 能力步骤改为“可选增强”。创建的基础硬门槛只包含有效名称、受支持 Harness、已保存 Provider/模型、当前认证和同配置最小模型调用。能力可全空；已选项的不兼容、未批准、未验证或安装失败仍阻断完成。
2. Main 提供真实能力目录：内置 Prompt/Memory 模板、代码内固定 Skill 方案、当前项目 MCP 和已验证组件。选择以完整非敏感目录事实 staged 到 setup session，完成时原子安装/关联。手工 Markdown 保留为高级新建支路。
3. MCP 显式区分 Streamable HTTP 与本地 stdio。stdio 命令和 argv 分字段并经 Zod 严格校验；Main 解析可执行文件并使用最小环境、`shell:false`、独立进程组启动。HTTP 仅允许 HTTPS 或 loopback HTTP，不跟随重定向。URL query、嵌入凭证和疑似凭证 argv 失败关闭。
4. `McpRuntime` 负责 MCP 2024-11-05 握手、initialized、tools/list 与 tools/call，且具有输出上限/脱敏、超时、取消、单航班和退出清理。它不位于 Renderer，不拼接 shell，不自动启动目录未明确选择并批准的 server。
5. Pi 的 MCP 能力标为 `adapted`。`NativeAgentCore` 先对已批准 Profile server 建立 lease 和工具目录，只执行 Pi 通过严格 envelope 请求且仍存在于已批准目录的一次工具调用，将工具结果标记为不可信数据后交回同一 session。OpenClaw 和 Codex 当前标为 `unavailable`；不再依赖不可验证的用户级同名配置。
6. `external-harness` Agent 只走 Native-first chat/run。Renderer 隐藏 legacy 启动按钮，Main 对误调 `runs:start` 返回语义化恢复动作，Preload 清理 Electron remote-method 前缀。旧 Agent 模式、Harness X/Research Y、CLI envelope、revision 冲突与不可变 Version 行为不变。
7. setup 中的 MCP 校验记录只保存非敏感 server 快照、配置哈希、工具名和脱敏失败。配置变更立即失效，finalize 在新工作空间重新验证。Secret 原文仍只允许 Keychain 原生输入/解析边界；当前 MCP Runtime 对未解析 secret reference 失败关闭。

## 后果

普通用户可以不编写占位 Markdown 就完成一个已认证 Native Agent，也可以从可审查来源选择能力并恢复未完成选择。Pi 获得一条可由无副作用 fixture 自动验证的本地 stdio/HTTP MCP 路径，但这是 Studio mediator 适配，不冒充 Pi 原生配置。

代价是 Studio 需要维护 MCP 协议边界、进程生命周期和逐 Harness 真实支持矩阵，且暂时不为 OpenClaw/Codex 提供 Profile MCP。这个不对称由 UI blocker 和恢复动作显式呈现，符合“少量真实支持优于统一但虚假的协议”。
