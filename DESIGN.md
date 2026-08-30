# Agent Stack Studio UI foundation

## Design read

Agent Stack Studio is a macOS research tool for people who need trustworthy structure and evidence. The interface is intentionally quiet, information-led, and close to a native desktop utility rather than a marketing dashboard.

Design dials: variance 5, motion 3, density 5.

## Tokens

- Typography: the macOS system sans stack for native legibility; SF Mono fallback for identifiers.
- Accent: indigo-blue, used only for primary actions, focus, and the active destination.
- Neutrals: cool gray surfaces with a single light theme for M0.
- Shape: 10px controls, 14px major surfaces, full circles only for icon buttons.
- Motion: 160ms feedback transitions; all non-essential transitions are removed under `prefers-reduced-motion`.
- Focus: a high-contrast 3px outline with 2px separation.

All body text and controls target WCAG 2.2 AA. State is communicated by text and icons, never color alone.

## Remote discovery pattern

Remote candidates use one continuous bordered list with compact metadata, not a card wall. A blue-tinted boundary label distinguishes read-only public metadata from local project facts. Download handoff expands inline beneath results and always shows review-required command text; there is no automatic execution affordance. Loading preserves the result footprint with skeletons, while cancellation, validation, rate limits, timeouts, offline errors, provider failures and empty results each retain a fact-specific recovery action. Local validation returns focus to the query; retryable provider states never imply that a request, result, or download was saved.

## Keychain settings pattern

Secret references use one bordered list followed by an inline metadata form. Each row shows purpose, account, service and a text-plus-icon local status. The secret itself is entered only in the macOS native hidden-input dialog initiated by Main, never in a Renderer field. Destructive removal expands to inline confirmation and cancel controls.

## Local runtime and capability pattern

The Run launcher shows a continuous boundary strip for the selected execution mode: immutable built-in behavior first, then the explicit statement that imported repositories remain static-only. Run facts translate mode and binding into human-readable Chinese while retaining the full Manifest disclosure. The capability page uses one dense bordered list rather than cards; each row pairs a capability with its current Owner and expandable Provider evidence. Ready and blocked states always include text and icons, never color alone.

## Agent status pattern

Agent status remains information-dense and continuous. List rows use aligned fact columns for version/draft, Stack, recent Run and publish state; the overview uses one definition list rather than metric cards. The detail title keeps the Agent name and actions dominant, with a wrapping status summary underneath so long names never collapse status labels into vertical text. Missing facts are stated explicitly instead of showing synthetic activity.

## Component catalog pattern

The catalog uses one filter bar and one horizontally resilient table. Component identity is the keyboard-accessible detail action; the detail expands as a single evidence document with a strong focus outline, two-column fact groups, and continuous capability/evidence/usage lists. Long source and Schema references wrap rather than clipping, while declared-only components explicitly show that no validation record exists.

## Workflow DAG pattern

Workflow editing is a structured, inline desktop form rather than a generic canvas. Each Workflow stays one continuous bordered document: compact identity/actions, optional editor, a horizontally readable node sequence, explicit edge chips, and immutable Version markers. Direct-cycle errors remain above the intact graph with a visible reload path. Node type is always written in text, and deleting draft structure never visually suggests that history was deleted.

## Component remediation pattern

Adapter/Fork remediation is one ordered evidence chain, not a task-dashboard card wall. Its section header exposes one dominant, keyboard-accessible “复制给 Coding Agent” action that copies a complete Markdown handoff; ordinary users never have to assemble the engineering stages themselves. Each row remains supporting evidence, pairing a text-and-icon state with the Component, stage, explanation, and expandable acceptance criteria. Completed contract evidence stays visually distinct from required runtime validation. The boundary statement remains visible: Studio does not generate, load, or execute third-party code. Permanent Component deletion expands inline in its existing row, keeping both confirm and cancel beside the affected identity.

## Run history pattern

Historical Run detail is a read-only evidence document. Failure stays prominent, followed by one compact projection that groups the immutable Prompt, seed, timeout, retry/concurrency and wall duration with the linked Experiment Drift result. Standalone Runs explicitly say that Drift is not applicable rather than presenting synthetic success. The event timeline and execution boundary remain below the projection, so users can move from outcome to reproduction facts to low-level evidence without editable controls.

## Experiment matrix pattern

Experiment results remain one continuous evidence surface: progress and the immutable reproduction definition precede the matrix, while filters narrow the same saved cells without changing the experiment. “Terminal” is kept distinct from “succeeded”; failures, cancellations and Drift blocks share a clearly labelled attention filter, and partial completion always keeps the planned denominator visible. The comparison table states its first Prompt/seed baseline and uses a dash when a cancelled or failed combination has no meaningful duration, avoiding synthetic relative metrics.

## Workspace command-center pattern

The topbar is a compact factual instrument strip: the current project and revision anchor the left, local search stays visually central, and Run state plus one create action occupy the right. The command palette is one continuous list rather than a grid of shortcuts. Category labels remain quiet, entity identity stays dominant, and keyboard selection is always visible. Summary errors degrade only the affected topbar control; they never replace the active workspace view.

## Agent-first composition pattern

Primary navigation follows user tasks: Agent, Component Library, Discovery, Experiments, Runs and Settings. The current project is a compact global context control in the top bar, not a primary destination. Its secondary Project Settings view contains path, revision, integrity/recovery, import/export and CLI discovery only.

The Agent Stack tab is one continuous composition surface: component picker, ordered membership, capability Owner choices, shared compatibility evidence, blockers and suggested actions, then structured Workflow editing. The freeze action says “冻结 Agent Version” and remains visually tied to validation. Users never edit Descriptor JSON. Advanced identifiers and evidence expand progressively; default copy states capability, impact and next action.

## Model authentication pattern

Harness、Provider、模型与认证是 Agent 构建中的一个连续文档。Harness 使用紧凑 radio 行；Provider、模型和 Harness 实际支持的认证方法顺序展开。模型控件同时提供 Studio 推荐项和可应用的完整模型 ID 输入，避免新模型发布被静态目录阻断；自定义值仍须通过当前 Harness 的真实验证。API Key 只由“安全输入 API Key”按钮打开 macOS 隐藏输入，不在 Renderer 出现 secret field。官方登录启动固定 Harness 入口；已有登录只检查状态。验证按钮之前持续显示可能产生少量模型调用费用，后台状态刷新不调用模型。

底部 readiness 定义列表固定展示 Stack/兼容性、Harness 可执行、模型认证和最小模型调用四项事实。只有四项同时通过才写“Agent 就绪”；阻断状态保留全部选择并提供与原因相邻的直接恢复动作。区域使用一个 14px 外框和行分隔，不使用认证卡片墙、嵌套面板或多层弹窗。

## Optional capability catalog pattern

第四步使用“能力（可选增强）”而不是必填文档。页首先显示已选能力的紧凑列表和单步移除；未选时明确写“不阻止创建”。下方目录是一个可搜索、可筛选的连续表面，用名称→摘要→来源/支持的层级表达 Prompt、Memory、Skill、MCP 和项目组件。选中、不可用和已全部添加使用文字+状态标签，不只靠颜色。手写 Prompt/Memory/Skill 收在底部的“新建内容（高级）”，不与已安装目录项混淆。

MCP 编辑使用单层 disclosure list。摘要行同时表达 HTTP/stdio、批准与验证状态；展开后先选 transport，再显示 endpoint 或 executable/argv，然后是风险说明、Harness 真实支持、明确批准和“测试连接与工具发现”。不使用 JSON textarea，不提供 token 输入。验证失败在当前 server 下直接给出原因与恢复动作。

## Compatibility disposition pattern

“机器证据不足” is an explanatory state, never a pending-confirmation affordance. Component detail is a continuous evidence document: plain-language status and missing evidence first, structured next actions second, the complete Descriptor form third, then receipts, artifacts, superseded evidence and audit history. Strategy selection is visually labelled as a disposition direction; the read-only validation level remains separate. Array editors use stable keyboard focus, inline schema errors and a zero-write Cancel path. Runtime validation has one visible progress state and an adjacent Cancel action; failure keeps the document intact and offers the same retry entry.

Archived Components stay in the same catalog through an Active / Archived / All filter. Restore is the primary lifecycle action for an archived row and returns it to the Agent picker immediately. Permanent deletion stays disabled until archival and expands inline only after reference protection has been evaluated.
