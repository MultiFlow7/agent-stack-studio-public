# Product

## Register

product

## Users

主要用户是已经听说过 Agent、Prompt、Skill 或 MCP，但不会写代码的普通 Mac 用户。他们希望像搭乐高一样先选择一个真实 Harness，再添加需要的能力，在 Studio 里聊天或试运行，确认可用后发布到 Multica。

Coding Agent、CI 和熟悉 Shell 的用户仍是一等调用方，但不是 GUI 默认路径的设计中心。它们通过产品级 `studio` CLI 调用与 GUI 相同的 Studio Core，并读写同一份 `.agent-stack`。

## Product Purpose

Agent Stack Studio 是本地优先的 macOS Agent 组装与发布工具。它把 Harness、Prompt、Skill、Markdown Memory、MCP Tool 和其他已验证组件变成可选择、可安装、可试用、可更新和可恢复的积木。

成功意味着用户能完成一条短路径：在连续引导中命名 Agent、选择 Harness并连接模型，按需从真实目录添加能力，完成检查后进入首次聊天或单次运行，再独立冻结版本并明确发布到 Multica。能力是可选增强，空能力不会被迫填 Markdown才能创建。开始引导不等于创建 Agent；取消不会留下空壳，只有主动“保存并退出”才会保留一个标记为“设置未完成”的本机草稿。用户不需要先理解 Owner、Receipt、Runtime Adapter、完整 Descriptor、科研实验矩阵或 Cordis。

Studio 不替代 Harness，也不把所有 Harness 改造成统一运行协议。Studio Core 管理项目事实、安装计划、兼容性、版本、聊天/运行/发布请求和审计；Host Driver 通过 Harness 已公开且受控的原生入口完成执行。GUI 与 CLI 共享 Core、`.agent-stack`、revision 并发保护和原子写入。

## Brand Personality

克制、清晰、可信。界面像一张安静的工作台：当前 Agent、Harness、已安装能力和下一步始终清楚，高级证据按需展开，不用术语制造权威感。

## Anti-references

- 不做科研实验平台扩展、公共市场或推荐系统。
- 不把通用 Workflow 画布或完整 18 模块协议作为默认入口。
- 不要求普通用户选择 Owner、编辑 Descriptor 或理解 Runtime Adapter。
- 不把 fixture Harness、静态扫描或本地 Contract Test 表述为真实集成。
- 不让 Studio 自动执行未知 GitHub 项目、安装脚本、Hook 或二进制。
- 不直接修改 Multica，不复制其前端代码、品牌资产或具体视觉样式。

Multica 是明确的发布目标和团队协作边界；Studio 负责本地创建、试用、冻结和发布，不建设第二套团队云服务。

## Design Principles

1. Agent 是入口。每个 Agent 绑定一个主要 Harness，并组合可见能力。
2. Native-first。真实执行优先走 Harness 原生 CLI、SDK 或进程协议；只有需要 Studio 内部生命周期组合的能力才进入 Cordis Runtime 边界。
3. 先成功，再解释。普通路径展示“能做什么、是否可用、下一步是什么”；来源、权限、兼容证据和降级按需展开。
4. 一个项目事实来源。可移植事实只保存在 `.agent-stack`；GUI 与 CLI 不复制 Core 规则，SQLite 只保存本机索引、聊天/运行/发布记录和密钥引用。
5. 冻结后发布。聊天和试运行可以使用草稿，但发布必须绑定不可变版本和内容哈希。
6. 未知代码默认不执行。已知开源项目只能通过版本固定、可审计的安装方案接入；未知项目只生成交给 Coding Agent 的 Markdown 定制任务。
7. 需要 Adapter / Fork 工程处置时，GUI 必须提供单击复制的完整 Coding Agent 提示词；普通用户不需要先理解或手工拼接契约测试、运行验证等工程步骤。
8. 权限最小化。Renderer 不访问 Node、文件系统、数据库或 Keychain；Host Driver 只获得明确声明的路径、网络和密钥引用。
9. 失败可恢复。安装、更新、迁移和发布要幂等；写入使用 revision 和原子替换，变更前保存可恢复快照。
10. 兼容性表达降级。组件在不同 Harness 上能力不同，Studio 必须显示原生、适配、降级或不可用，不能静默丢能力。
11. 旧能力不污染新路径。Experiment、Workflow、Owner、Receipt、完整 Descriptor 和 runtimeAdapter 继续用于历史读取、迁移与高级诊断，但不占据普通用户默认流程。
12. 模型认证属于构建。Provider、模型、认证方式与本机验证紧跟 Harness 选择；CLI probe 或孤立密钥引用不能单独构成 Agent 就绪。
13. 创建完成是领域承诺。普通 GUI 只有在名称、可识别 Harness、Provider/模型、当前认证和最小真实调用同时就绪后，才原子建立 Agent 与项目引用；能力可以为空，但任何已选能力必须通过自身安装、兼容和验证门禁。冻结 Version 仍是创建后的独立动作。
14. 能力首先是可发现的目录项。Prompt、Skill、Memory、MCP 和项目组件先显示真实来源、详情和 Harness 支持；手写 Markdown 是明确的“新建内容（高级）”支路，不冒充已安装插件。
15. MCP 能力必须如实运行。Pi 可由 Studio Native Runtime 受控适配用户明确批准的 stdio 或 Streamable HTTP server；OpenClaw 和 Codex 当前不消费 Profile MCP，因此显示不可用而不是伪成功。external-harness Agent 只走 Native chat/run，不进入旧 `runs:start` Runtime 白名单。

## Product Command Surface

面向用户和 Agent 的产品命令按以下稳定分组组织：

- `studio agent`：创建、查看、校验、冻结和导出 Agent。
- `studio harness`：识别、选择、安装、更新、测试和移除 Harness。
- `studio component`：识别、安装、更新、测试、移除和恢复能力组件。
- `studio chat`：面向人的交互式聊天和会话恢复。
- `studio run`：面向 Agent/CI 的非交互单次运行。
- `studio publish`：Multica 校验、发布和状态。
- `studio customize`：静态识别来源并生成 Coding Agent 定制任务。
- `studio doctor`：诊断 App、CLI、项目、Harness、凭证引用、迁移和分发状态。

旧 `project`、`stack`、`owner`、`version`、`workflow`、`source` 和 `secret` 命令在迁移期保持兼容，机器 envelope 和退出码不变，并返回可机读弃用提示与对应新命令。不会在替代命令可用前删除旧入口。

## Accessibility & Inclusion

界面遵守 WCAG 2.2 AA。主要路径完整支持键盘和 macOS 减少动态效果；状态同时使用文字与图标；表单错误靠近字段；专业术语必须给出自然语言解释，高级证据默认收起。
