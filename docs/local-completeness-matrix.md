# 本地产品完整性矩阵

## 冻结规则

- 首次冻结基线：`codex/m12-local-runtime-modes@bceec476a6205a047efab7523ec75015ad70a905`。
- 首次冻结日期：2026-08-20；矩阵状态描述该基线的可验证事实，不继承路线图中的“已完成”声明。
- 状态只使用 `COMPLETE`、`MISSING`、`PARTIAL`、`UNTESTED`、`EXTERNAL-BLOCKED`、`EXPLICITLY-OUT-OF-SCOPE`。
- “打包应用证据”中的“间接”表示最终包包含并通过安全/启动检查，但该原子流程尚未由 packaged E2E 操作；用户可见流程至少还需要 GUI 自动化或 packaged E2E 证据。
- 本表首次冻结后只允许：更新状态/证据/处置，或追加完成既有冻结需求所必需的依赖行；不得删除、合并或改号。

## 冻结需求

| 需求 ID | 来源文件和章节 | 用户场景 | 当前状态 | GUI 证据 | CLI/API 证据 | 自动化测试证据 | 打包应用证据 | 最终处置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LC-001 | PRODUCT.md / Users；PRD 1 | 用户在 Mac 本机使用，不需要账号、浏览器或共享服务 | COMPLETE | `App.tsx` 本地工作空间与空状态 | 本地 `studio` CLI | `App.test.tsx`；Electron 安全测试 | `e2e-packaged-app.mjs` 实际启动 `.app` | 保持硬边界 |
| LC-002 | ADR 0001；技术架构 1 | 产品仅支持 macOS Electron 桌面形态 | COMPLETE | Electron Renderer | 无 Web 控制台 API | `package-macos.test.mjs` | DMG/ZIP/`.app` 构建与元数据验证 | 保持硬边界 |
| LC-003 | PRODUCT.md / Principle 6；ADR 0003 | GUI 与 CLI 读取同一 `.agent-stack` 事实来源 | COMPLETE | `StudioProjectView.tsx` | `studio project/component/stack/version` | `studio-project-service.test.ts` | CLI 随 `.app` 打包；流程间接 | 保持共享 Core |
| LC-004 | ADR 0003；技术架构 12 | SQLite 只保存本机索引与记录，不复制项目可编辑事实 | COMPLETE | 项目页读取 Core 状态 | Core/CLI 直接读项目文件 | `project-index-repository.test.ts` | 包验证包含同一实现 | 保持职责边界 |
| LC-005 | PRD 7；UI 2/3 | 首次启动显示 Agent 空状态及创建、导入两条路径 | COMPLETE | `App.tsx` | `agents.create` / import API | `App.test.tsx` 空状态测试 | packaged E2E 从空状态创建 Agent | 保持 |
| LC-006 | PRD 7；UI 3 | 创建空白 Agent 并在列表读取 | COMPLETE | `CreateAgentDialog.tsx`、`App.tsx` | Agent IPC | `App.test.tsx`；`agent-repository.test.ts` | packaged E2E 创建 Hybrid Agent | 保持 |
| LC-007 | PRD 5.1；UI 3 | 从本地目录静态导入 Agent/Harness，不执行未知代码 | COMPLETE | `ImportProjectDialog.tsx` | Agent import IPC | `agent-service.test.ts`；`static-project-scanner.test.ts` | 最终包包含；流程间接 | 保持静态边界 |
| LC-008 | UI 3 | 从既有 Agent 复制为新 Agent | COMPLETE | Agent 详情“复制 Agent”，明确历史不复制 | Zod IPC/Preload 调用共享 AgentService | `agent-repository.test.ts`；`agent-service.test.ts`；`App.test.tsx` | packaged E2E 复制当前 Stack | M13 完成 |
| LC-009 | UI 3 | 归档 Agent，默认列表不再显示 | COMPLETE | 详情归档与 active/archived 筛选 | Zod IPC/Preload | Repository/Service/App tests | packaged E2E | M13 完成 |
| LC-010 | 用户目标 / Agent 恢复 | 查看已归档 Agent 并恢复 | COMPLETE | 归档空态、列表、详情恢复 | Zod IPC/Preload | Repository/Service/App tests | packaged E2E 有历史 Agent 恢复 | M13 完成 |
| LC-011 | 用户目标 / Agent 删除；UI 3 | 对无历史引用 Agent 永久删除，并内联二次确认 | COMPLETE | 内联确认、取消、成功/失败 | Zod IPC/Preload + AgentService | Repository/Service/App tests | packaged E2E 删除无历史副本 | M13 完成 |
| LC-012 | 用户目标 / 历史引用保护；核心对象 3 | 有 Version、Run、Experiment、Receipt 等历史引用时拒绝永久删除 | COMPLETE | 冲突保留归档并显示具体引用 | Repository 统一检查 + FK 第二道保护 | Repository/Service/App tests | packaged E2E 以 Version/Run 原件验证阻断截图 | M13 完成 |
| LC-013 | UI 3/4 | Agent 列表真实显示当前版本、草稿、执行模式、Stack、最近 Run、发布状态 | COMPLETE | `App.tsx` 连续列表读取同一状态投影，显示版本/草稿修订、模式、Stack 组件与问题、最近 Run、发布 | `agent-status:list` 严格 IPC/Preload；只读聚合现有 Agent/Stack/Run/Experiment/Receipt | `agent-status-service.test.ts`；`register-agent-ipc.test.ts`；`App.test.tsx` | 最终 `.app` 完成 Version+成功 Run 后断言列表真实状态；`AGENT_STATUS_PROJECTION VERIFIED` | M19 关闭；不新增重复持久化事实 |
| LC-014 | UI 4 概览 | Agent 概览真实显示模式、版本、组件、问题、最近 Run、发布 | COMPLETE | `AgentDetailView` 顶部和概览显示同一投影；回到概览自动刷新，包含最近实验 | `agent-status:get` 严格 IPC/Preload | Service/IPC/App 聚合测试覆盖有数据、空列表、严格输入与详情/列表一致 | `artifacts/packaged-app-e2e-agent-status.png`；实际 Hybrid Run 后显示就绪、1 组件、0 问题、成功 Run、未发布 | M19 关闭；发布状态只来自 Receipt，不把未配置 Multica 误报为发布 |
| LC-015 | PRD 3/7；M1 | 编辑 Agent 名称、说明、模式只更新草稿，不改历史版本 | COMPLETE | Agent 设置表单 | Agent update IPC | `agent-repository.test.ts` 不可变快照；App 流程 | 最终包间接 | 保持 |
| LC-016 | PRD 3/7；M1 | 从草稿创建不可变 Agent Version | COMPLETE | “创建版本” | Agent version API | `App.test.tsx`；`agent-repository.test.ts` | packaged E2E 创建版本 | 保持 |
| LC-017 | UI 4 | Agent 详情页签含概览、Stack、能力、实验、运行、设置且键盘可达 | COMPLETE | `AgentDetailView.tsx` | N/A | `App.test.tsx`；accessibility contract | packaged E2E 访问多页签 | 保持 |
| LC-018 | PRD 7；组件模型 2/3 | Component Descriptor 表达身份、能力、依赖、平台、来源、配置和 Adapter | COMPLETE | 组件/项目视图展示主要字段 | Core/CLI import/inspect | `component.test.ts`；schema | 最终包间接 | 保持 |
| LC-019 | 组件模型 3/9；ADR 0008 | Descriptor 与用户确认都不自动授予执行权限 | COMPLETE | 边界文案与阻断状态 | Core/Runtime 精确白名单 | `component-inspector.test.ts`；`run-executor.test.ts` | packaged E2E 展示静态边界 | 保持 |
| LC-020 | PRD 5.1；ADR 0003 | 静态扫描只读取允许的 Manifest/README/license/Git/有限树 | COMPLETE | 导入/项目检查 | `component inspect/import` | `component-inspector.test.ts` | 最终包间接 | 保持 |
| LC-021 | ADR 0003；组件模型 9 | 证据等级区分 declared/detected/user-confirmed/contract-tested/runtime-verified | COMPLETE | 项目与能力视图 | Core/CLI | `component-inspector.test.ts`；`studio-core.test.ts` | 能力 packaged 截图 | 保持 |
| LC-022 | UI 5 | 全局组件页提供可筛选表格及版本、来源、覆盖、兼容、使用方、最近验证 | COMPLETE | `ComponentCatalogView.tsx` 支持名称/Contract/能力搜索、兼容与来源筛选；显示草稿使用方、不可变版本和最近验证记录 | `components:catalog` 严格只读 IPC/Preload；投影现有 Descriptor/Agent/Version | `component-catalog-service.test.ts`；`register-component-ipc.test.ts`；`ComponentCatalogView.test.tsx` | 最终 `.app` 在真实 Agent 草稿+Version 后断言目录计数；`COMPONENT_CATALOG_DETAIL VERIFIED` | M20 关闭；declared 不伪造验证时间 |
| LC-023 | UI 5 | 组件详情展示 Manifest、来源证据、依赖、Adapter/Fork、Schema、测试与受影响版本 | COMPLETE | 目录键盘打开连续详情；展示 Manifest/来源/平台/许可、提供/依赖、替换与 Adapter/Fork、Schema/Keychain 边界、证据、草稿与 Version | `components:get` UUID 白名单 + 共享 `ComponentCatalogItem` | UI 覆盖成功/失败/重试/键盘；Service 覆盖 active/archived 与历史 Version；IPC 拒绝额外路径 | `artifacts/packaged-app-e2e-component-detail.png`；真实 Harness X 详情与 Agent/Version 断言 | M20 关闭；详情为只读证据，不授予执行权限 |
| LC-024 | PRD 5.2；组件模型 5 | 重叠能力必须逐项显式选择唯一 Owner | COMPLETE | `StackEditorView.tsx` | Core/CLI owner set | `runtime-plan-compiler.test.ts`；`StackEditorView.test.tsx` | packaged E2E 单组件无重叠 | 保持；增加 packaged 冲突场景 |
| LC-025 | PRD 5.2；组件模型 5/7 | Owner 选择后检查依赖、兼容性和未选副作用并阻断 | COMPLETE | Stack 预检问题 | Core validate | `runtime-plan-compiler.test.ts`；`studio-core.test.ts` | 最终包间接 | 保持 |
| LC-026 | PRD 7；UI 6 | 需要 Adapter/Fork 时生成明确任务，未验证前 Stack 不就绪 | COMPLETE | Agent 能力页与 Studio 项目页显示同一有序任务链、已有证据/待完成和可展开验收条件 | Runtime Plan 与 Project Validation 共用 `buildCompatibilityRemediationTasks`；CLI data + required suggestedActions | `remediation.test.ts`；compiler/Core/CLI/Capability tests；任务不进入项目文件 | `COMPONENT_REMEDIATION_TASKS VERIFIED`；Agent 与项目任务截图；包内 CLI 返回 3 阶段且仅运行验证 required | M22 关闭；派生投影不持久化、不生成/执行代码、不授予 Runtime 信任 |
| LC-027 | UI 14；ADR 0003 | 更正 Descriptor 并记录 user-confirmed | COMPLETE | Studio 项目 Descriptor 更正 | `component update`/descriptor API | `studio-core.test.ts`；`StudioProjectView.test.tsx` | 最终包未操作 | 保持 |
| LC-028 | UI 14；ADR 0003 | Component 加入/移出 Stack、归档与永久删除均可操作 | COMPLETE | Studio 项目页 revision-aware 加入/移出/归档、行内确认/取消、成功和历史失败保留 | 包内 CLI 对每一步读取同一项目；Core 全部命令 | `StudioProjectView.test.tsx` 覆盖取消/成功/历史失败；Core/CLI 覆盖引用保护 | `PROJECT_COMPONENT_LIFECYCLE VERIFIED`；revision 3→8；删除确认与成功截图 | M22 关闭；取消零写入，项目/Workflow 历史引用继续阻止删除 |
| LC-029 | ADR 0003；UI 14 | 历史 Version 引用阻止 Component 永久删除并给出建议 | COMPLETE | 项目页表达错误 | Core/CLI `COMPONENT_IN_USE` + suggestedActions | `studio-core.test.ts`；CLI error test | 无 | 保持 |
| LC-030 | PRD 6；技术架构 8 | Workflow 是版本化 DAG，保存时检测直接/间接循环引用 | COMPLETE | Studio 项目页结构化创建/节点/边/删除/冻结与只读 DAG 图示；保留空、取消、失败、冲突和外部刷新状态 | `.agent-stack` v2 + 共享 Studio Core；`studio workflow create/list/inspect/node-add/node-remove/edge-add/edge-remove/freeze`；6 个严格 IPC | `workflow-core.test.ts` 覆盖直接/间接循环、幂等冻结、历史不变与 Component 引用保护；ProjectStore v0/v1/v2 兼容；CLI/IPC/UI tests | `VERSIONED_WORKFLOW_DAG VERIFIED`；DAG/循环失败截图；M22 回归中 GUI↔CLI revision 8→15 与 v2 包一致 | M21 关闭；项目 Workflow 不自动获得 Runtime 信任 |
| LC-031 | PRD 6/8 | MVP 不提供通用可视化 Workflow 编辑器 | EXPLICITLY-OUT-OF-SCOPE | 无通用画布 | 无 | 文档边界 | N/A | 不扩展产品范围 |
| LC-032 | PRD 7；ADR 0008 | Agent Loop 本地可信 Profile 可完成 Run/Experiment | COMPLETE | Run/Experiment UI | Run API | Run/Runtime/Experiment 参数化测试 | packaged E2E 覆盖 Hybrid；Agent Loop 间接 | 保持 |
| LC-033 | PRD 15；ADR 0008 | Workflow 本地可信 Profile 可完成 Run/Experiment | COMPLETE | 模式说明/运行 UI | Run API | 参数化 Run/Runtime/Experiment 测试 | 最终包未单独操作 | 保持；扩展 packaged 四模式 |
| LC-034 | PRD 15；ADR 0008 | Hybrid 本地可信 Profile 固化 Workflow、handoff、Controller | COMPLETE | 中文模式与 Manifest 事实 | Run API | Manifest/Runtime 参数化测试 | packaged E2E 完整覆盖 | 保持 |
| LC-035 | PRD 15；ADR 0008 | External Harness 仅执行内置 Harness X 可信契约 | COMPLETE | 边界说明 | Run API | Run/Runtime 参数化测试 | 最终包未单独操作 | 保持；扩展 packaged 四模式 |
| LC-036 | ADR 0008 | Runtime Adapter 使用完整引用白名单，不接受前缀/本地路径/用户确认 | COMPLETE | 阻断项 | Main + Runtime 双检 | `run-manifest.test.ts`；`run-executor.test.ts`；`run-service.test.ts` | Hybrid packaged 走可信绑定 | 保持 |
| LC-037 | 技术架构 3/5；实验 7 | 每个正式 Run 冷启动独立 Cordis 子进程并记录版本/计划哈希 | COMPLETE | Run 详情 | Run Manifest API | `runtime-controller.test.ts`；Manifest tests | packaged E2E 实际 Run | 保持 |
| LC-038 | PRD 15；ADR 0008 | Agent Loop/Hybrid/External Harness 缺 execution-controller 时排队前阻断 | COMPLETE | Stack/能力阻断 | Runtime Plan compiler | 参数化 compiler/run-service tests | 无 | 保持 |
| LC-039 | PRD 15；ADR 0008 | Workflow/Hybrid/External 绑定进入不可变 Manifest 和内容哈希 | COMPLETE | Run 详情/Manifest | Run API | `run-manifest.test.ts` | Hybrid packaged E2E | 保持 |
| LC-040 | PRD 15；实验 8/10 | Run 支持取消、超时、失败、进程异常和不同终态 | COMPLETE | RunsView 展示成功、超时、取消及失败原因 | Run cancel API | `run-service.test.ts`；`runtime-controller.test.ts`；runtime tests | packaged E2E 同时保留成功与真实 500ms 超时 Run | M23 增加超时打包证据；进程异常继续由自动化覆盖 |
| LC-041 | 技术架构 3；实验 8 | 应用退出时取消/清理活动 Run 与 Experiment | COMPLETE | 退出由 Main 管理 | 服务 shutdown | Experiment cancel/cleanup；Runtime controller tests | 无 | 保持 |
| LC-042 | PRD 3/9；实验 3 | Run Manifest 记录代码、配置、模型、数据集、Adapter、环境、权限等复现事实 | COMPLETE | 可展开 Manifest | Run API | `run-manifest.test.ts` | packaged E2E 展示执行绑定 | 保持 |
| LC-043 | 实验 8；技术架构 3 | Run 事件有序持久化，Artifact 有路径、SHA-256、大小 | COMPLETE | Run 详情事件/产物 | Run API | `run-repository.test.ts`；`run-service.test.ts` | packaged E2E 成功产物间接 | 保持 |
| LC-044 | PRD 7；UI 4 运行 | 历史 Run 不可修改，能查看失败原因、变量、耗时和 Drift | COMPLETE | Run 列表显示耗时；详情同屏显示失败、Manifest 变量、总耗时及 Experiment Drift/独立不适用，无终态编辑入口 | `RunHistoryService` + 严格 `runs:get/cancel` 投影；不读当前 Stack | `run-history-service.test.ts` 覆盖独立、clean、blocked；`register-run-ipc.test.ts`；`RunsView.test.tsx` 覆盖失败/变量/耗时/Drift | `RUN_HISTORY_OBSERVABILITY VERIFIED`；真实 Hybrid 500ms 超时与成功 Run 并存；`artifacts/packaged-app-e2e-run-timeout-history.png` | M23 关闭；派生投影不改 SQLite、项目、Runtime 或 CLI 项目协议 |
| LC-045 | PRD 5.3；实验 2/4 | Experiment 从不可变 Agent Version 建立并锁定至少五类控制变量 | COMPLETE | Experiment 创建页 | Experiment API | domain/service/UI tests | 最终包未操作 | 保持 |
| LC-046 | PRD 5.3；实验 5 | Prompt F × Seed G × repetition 展开矩阵 | COMPLETE | ExperimentsView | Experiment API | experiment domain/service/UI tests | 无 | 保持 |
| LC-047 | 实验 4/9 | Drift Check 区分预期变量与非预期变化，后者默认阻断 | COMPLETE | Experiment 阻断状态 | Experiment API | drift tests | 无 | 保持 |
| LC-048 | UI 7；实验 5 | 矩阵显示失败、取消、漂移、部分完成、指标与相对基准 | COMPLETE | 同屏显示计划/终态、成功/需关注、成功率、成功平均耗时、复现定义；按状态和 Prompt/seed/Run/失败原因筛选；失败/取消/Drift 原因与相对基线 | 既有严格 Experiment detail API；筛选零写入 | Experiment domain/service tests；`ExperimentsView.test.tsx` 覆盖 succeeded/cancelled/failed/blocked、部分结果、指标、筛选和空状态 | `EXPERIMENT_MATRIX_OBSERVABILITY VERIFIED`；真实 1 成功 + 3 取消；两张 M24 矩阵/基线截图 | M24 关闭；只读派生，不改 DB、项目/包、Runtime 或 CLI 项目协议 |
| LC-049 | 实验 6/9 | 实验支持安全 JSON/CSV 导出并防公式注入 | COMPLETE | 导出按钮/保存对话框 | Export API | `experiment-service.test.ts`；UI test | 无 | 保持 |
| LC-050 | 实验 6/9 | 外部数据集、LLM Judge、人工评分和高级统计 | EXPLICITLY-OUT-OF-SCOPE | 无 | 无 | 文档明确后续 | N/A | 不扩展当前范围 |
| LC-051 | PRD 5.4；Multica 2 | 领域层只依赖版本化 AgentPublisher 契约 | COMPLETE | 发布面板经服务 | AgentPublisher interface | publisher/service tests | 最终包间接 | 保持 |
| LC-052 | Multica 7；路线图 M5 | 无网络 Contract Test 目标完成预检、主动发布、Receipt、映射与安全重试 | COMPLETE | `PublishPanel.tsx` | Publish API | publish service/repository/UI tests | 最终包未操作 | 保持 |
| LC-053 | Multica 3/7；安全基线 | 发布包排除路径、Keychain、实验原始数据、日志和 Artifact | COMPLETE | 包含/排除预览 | Publish API | `publish-package.test.ts`；service test | 无 | 保持 |
| LC-054 | Multica 7；UI 8 | 发布需明确确认，失败不改本地 Version，成功显示远端标识/时间 | COMPLETE | PublishPanel | Publish API | `PublishPanel.test.tsx`；service tests | 无 | 保持 |
| LC-055 | Multica 2/6/7 | 真实 Multica Transport 只在官方认证/API/版本策略确认后接入 | EXTERNAL-BLOCKED | UI 明确“未配置” | unconfigured target | publish preflight tests | 无 | 等待真实外部接口与凭证 |
| LC-056 | PRD 11；ADR 0004 | GUI 与 CLI 主动搜索/检查 GitHub 公共来源，共享 Provider 契约 | COMPLETE | SourceDiscoveryView | `studio source` | Provider/CLI/UI tests | 最终包未操作 | 保持 |
| LC-057 | ADR 0004 | 只向固定 GitHub API 发送查询参数，不发送项目/设备/凭证 | COMPLETE | 边界说明 | GitHub Adapter | adapter contract tests | 安全包边界间接 | 保持 |
| LC-058 | ADR 0004；UI 15 | 搜索覆盖取消、空、无结果、离线、超时、限流、Provider 错误 | COMPLETE | 空闲、加载/取消、成功、有/无结果及本地校验、离线、超时、限流、Provider 错误均有事实对应文案和恢复动作；校验失败返回输入焦点 | Adapter 区分 `OPERATION_CANCELLED`、`DISCOVERY_TIMEOUT`、`DISCOVERY_NETWORK_FAILED`、限流/查询/Provider 错误；Preload 净化 6 个 IPC | Provider 6 tests；Service cancel；`SourceDiscoveryView.test.tsx` 8 tests 覆盖全部状态和键盘恢复 | `SOURCE_DISCOVERY_STATE_COVERAGE VERIFIED`；公开元数据空状态与本地校验失败截图，不依赖外网 | M25 关闭；无 Token、下载、持久化或未知代码执行 |
| LC-059 | ADR 0004 | 下载交接只生成需审阅的参数数组，Studio 不 clone/执行 | COMPLETE | 复制/交接，无下载按钮 | `source handoff` | core/service/CLI/UI tests | 安全包间接 | 保持 |
| LC-060 | PRD 11；ADR 0004 | 私有仓库、Token、GitHub Enterprise、后台索引 | EXPLICITLY-OUT-OF-SCOPE | 无 | 无 | 文档边界 | N/A | 不扩展当前范围 |
| LC-061 | ADR 0003；项目格式 | `.agent-stack` 有版本化 JSON Schema、revision 和唯一事实来源 | COMPLETE | Studio 项目页显示 v2 与 Workflow 事实 | Core/CLI 共用 `PROJECT_FORMAT_VERSION=2`；v1 Schema 保留 | Core/store/CLI/release compatibility tests | 最终包同时携带 project v1/v2 Schema | M21 升级 v2；保持单一事实来源 |
| LC-062 | ADR 0003；项目格式 | 写入使用期望 revision、同目录临时文件、fsync、原子 rename 和有效 backup | COMPLETE | revision-aware UI | CLI `--revision` | `project-store.test.ts` | 最终包间接 | 保持 |
| LC-063 | ADR 0003；UI 14 | 外部 CLI/编辑器修改触发 GUI 刷新并提示新 revision | COMPLETE | StudioProjectView 刷新提示 | CLI 修改 | service/UI tests | 无 | 保持；补 packaged 双向 fixture |
| LC-064 | ADR 0003；UI 14 | revision 冲突不覆盖磁盘，保留状态并提供重新读取 | COMPLETE | 冲突错误/重新读取 | 稳定错误码 + suggestedActions | store/CLI/UI tests | 无 | 保持 |
| LC-065 | ADR 0003；项目格式 | 历史项目迁移，主文件损坏或迁移失败时从有效 backup 恢复，新版拒绝降级 | COMPLETE | 恢复提示沿用并显示 v2 | Core inspect/audit | `project-store.test.ts` 覆盖 v0/v1→v2、迁移失败恢复、v3 拒绝和损坏恢复 | packaged CLI 初始化/审计 v2 | M21 扩展项目格式兼容边界 |
| LC-066 | ADR 0006；项目格式 | 每次读取重算所有项目/Workflow Version 快照哈希并检查历史语义 | COMPLETE | 项目审计状态 | `project audit` | integrity/store/workflow/CLI tests；Workflow 序号、来源 revision、ID/哈希唯一性 | packaged Workflow freeze 后导出并复核 | M21 扩展 Workflow Version 完整性 |
| LC-067 | ADR 0006 | 审计失败只读阻断；普通读取仅从通过审计的 backup 恢复并保留 invalid 原件 | COMPLETE | role=alert 恢复提示 | audit/inspect 分离 | integrity/store/service/UI tests | 无 | 保持 |
| LC-068 | ADR 0006 | 文案不把 SHA-256 表述为签名、作者认证或供应链证明 | COMPLETE | 项目页限定文案 | CLI report | UI/test/docs | 最终包间接 | 保持 |
| LC-069 | 用户目标 / GUI↔CLI | 本地 fixture 完成 GUI→CLI 与 CLI→GUI 双向一致全流程 | COMPLETE | Stack、Component 生命周期与 Workflow 均完成双向修改和连续外部刷新 | `.app` 内 CLI 读写同一 fixture，并复核派生任务与每个 revision | service watcher、UI 与 packaged E2E | `PACKAGED_GUI_CLI_BIDIRECTIONAL VERIFIED`；Component revision 3→8；Workflow revision 8→15 | M14 基础 + M21/M22 扩展 |
| LC-070 | 技术架构 11；分发 4 | SQLite 全新数据库与所有受支持历史版本升级 | COMPLETE | 启动路径 | Repository API | `migrations.test.ts`；各 repository migration tests | packaged 启动新库 | 保持 |
| LC-071 | 用户实施要求 / 迁移失败恢复 | 每个数据库迁移中途失败都回滚，旧 schema/数据可继续读取或安全重试 | COMPLETE | 启动统一迁移错误边界 | `migrate` 每版本独立事务 | `migrations.test.ts` 注入历史 schema 冲突，验证旧数据、回滚、修复后重试至 v8 | packaged 启动全新 v8 | M13 完成 |
| LC-072 | 技术架构 11；分发 4 | 新 schema 拒绝旧应用降级读取/改写 | COMPLETE | 启动阻断 | migrate API | `migrations.test.ts` | 无 | 保持 |
| LC-073 | 技术架构 11；分发 5 | 备份使用 SQLite online backup，含 manifest/hash，排除日志/密钥/符号链接 | COMPLETE | SettingsView | Maintenance IPC | maintenance tests | packaged E2E 检查备份边界文案 | 保持 |
| LC-074 | 技术架构 11；分发 6 | 恢复预检完整性/版本，重启前 staging，替换前自动回滚，失败回滚 | COMPLETE | SettingsView 连续流程 | Maintenance API | maintenance tests | 最终包未执行恢复 | 保持；补 packaged 恢复 fixture |
| LC-075 | 分发 5/6 | 应用外项目与 Application Support/Workspace/Artifacts/Recovery 边界稳定可解释 | COMPLETE | 设置页显示 6 个 Main 解析位置、备份范围、Finder 操作和卸载保留边界 | `MaintenanceStatus` 投影路径；严格枚举 IPC 拒绝原始路径 | maintenance service / IPC / Settings 测试 | packaged E2E 输出 `DATA_LOCATION_BOUNDARIES VERIFIED`；`artifacts/packaged-app-e2e-data-locations.png` | M16 关闭；不新增自动删除 |
| LC-076 | ADR 0007；PRD 14 | Keychain 真实写入/替换/状态/删除，SQLite 只留引用 | COMPLETE | SecretReferencesPanel | `studio secret` | adapter/service/CLI/UI tests | packaged E2E 截图引用 UI | 保持 |
| LC-077 | ADR 0007 | 密钥不进入 argv、Renderer、项目、SQLite、备份、日志或机器输出 | COMPLETE | Renderer 无 secret 字段 | stdin-only CLI/Main trusted read | secret schema/adapter/publish/backup tests | Renderer 边界与设置截图 | 保持；继续扫描 |
| LC-078 | UI 17 | Keychain 流程覆盖加载、空、失败、缺失、替换、取消、内联删除确认和键盘 | COMPLETE | SecretReferencesPanel | Secret API | `SecretReferencesPanel.test.tsx`；service tests | packaged 仅截图空表单 | 保持；补 packaged 错误/删除 |
| LC-079 | ADR 0005；技术架构 3/9 | Renderer 无 Node/FS/DB/密钥，contextIsolation/sandbox/webSecurity 开启 | COMPLETE | Preload 白名单 | N/A | security tests | ASAR 验证 + packaged Node 检查 | 保持 |
| LC-080 | ADR 0005 | 所有 IPC 输入/输出 schema 校验且拒绝非本地 Renderer 来源 | COMPLETE | 白名单 bridge | validated handlers | validated-handler tests；共享 schemas | ASAR/Main 标记验证 | 保持；新增频道继续测试 |
| LC-081 | ADR 0005 | Session 权限/设备/下载和 WebContents 新窗/导航/WebView 默认拒绝 | COMPLETE | 无危险能力 | security module | electron-security tests | ASAR 标记验证 | 保持 |
| LC-082 | ADR 0005 | Renderer CSP 离线并拒绝对象、表单、Frame、媒体、Worker、不安全脚本 | COMPLETE | index.html CSP | N/A | renderer/script security tests | 读取实际 ASAR 验证 | 保持 |
| LC-083 | AGENTS.md；UI 10/11 | 主要流程覆盖加载、空、成功、失败、取消、冲突、外部刷新和完整键盘路径 | PARTIAL | Agent/Component 生命周期覆盖取消、成功、历史失败和键盘；Studio Project 覆盖外部刷新与冲突；Run/Experiment 覆盖多终态；Source Discovery 完整覆盖空、加载、成功、无结果、取消和四类失败/键盘恢复 | API 错误多为结构化 | 243 tests，但缺逐页面全状态清单 | packaged 覆盖 Agent 历史冲突、Component 生命周期、Studio Project 外部刷新、Run 超时、Experiment 部分取消与 Source 本地失败 | 逐页面补齐测试/截图后更新 |
| LC-084 | PRODUCT Accessibility；UI 10 | WCAG 2.2 AA：语义、焦点、对比、错误、图标名称、减少动态 | PARTIAL | 全局样式与语义基础 | N/A | accessibility contract / UI tests | packaged 截图有焦点，未做完整对比/VoiceOver 验收 | 完成本地可自动化审计与人工截图清单 |
| LC-085 | UI 2 | 记住窗口大小、侧栏状态和最后访问位置 | COMPLETE | 侧栏有键盘可达收起/展开；重载恢复最后页面和侧栏 | Main 记录可见屏幕内的 normal bounds/最大化；严格偏好 IPC | preferences service/IPC/App 测试，包括损坏回退和离屏坐标 | `PERSISTED_UI_PREFERENCES VERIFIED`；`artifacts/packaged-app-e2e-preferences.png` | M17 关闭；复用 v7 `app_preferences`，不改项目格式 |
| LC-086 | UI 2；PRD 4 | 顶栏提供当前工作区、全局搜索、运行状态和应用级操作 | COMPLETE | 真实项目/revision/验证状态、Run 状态、`⌘K` 搜索、创建与实体直达；摘要失败不阻断页面 | 只读 `CommandCenterService`；严格 snapshot/search IPC 与目的地白名单 | Core/Service/IPC/App/CommandPalette 及 Component/Run/Experiment 直达测试；Project summary 不吞外部修改回归 | `WORKSPACE_COMMAND_CENTER VERIFIED`；`artifacts/packaged-app-e2e-command-center.png`；真实 Hybrid Run 后键盘搜索并打开 Agent | M26 关闭；不新增持久化或执行权限 |
| LC-087 | UI 9 | 全局状态词在页面间一致，图标+文字+颜色共同表达 | COMPLETE | Run、Experiment、Stack、Publish、工作区与活动状态集中于 `copy.ts`；顶栏/命令面板用图标+文字，颜色仅辅助 | 共享 Schema 固定状态集合；命令中心输出严格复核 | App、Capability、StackEditor、PublishPanel、Runs、Experiments tests；类型穷尽映射 | M26 命令中心与既有中文状态截图复核 | M26 关闭；后续新增状态必须进入集中映射 |
| LC-088 | 技术架构 6；用户目标 | 导出不含密钥的可移植 Agent Stack Package | COMPLETE | Studio 项目页原生保存、成功/取消/失败和键盘路径 | 共享 Core `exportProjectPackage`；`studio project export --output` | package builder/hash/path audit、Workflow v2 保留、Core/CLI/GUI 一致、严格 IPC、release compatibility 测试 | 最终 `.app` GUI 与包内 CLI 在含 Component、Workflow Version 的 revision 15 逐字一致；派生处置任务不进入包；`SECRET_FREE_PORTABLE_PACKAGE VERIFIED` | M18 基础；M21 包 v2；M22 回归非持久化边界 |
| LC-089 | PRD 8 | 团队账号、实时协作、云 DB、远程 Runtime、市场、同进程热替换 | EXPLICITLY-OUT-OF-SCOPE | 无 | 无 | 文档边界 | N/A | 不扩展范围 |
| LC-090 | 组件模型 8；用户硬边界 | 未知第三方代码、脚本、Hook、Makefile、二进制和依赖安装默认不执行 | COMPLETE | 清晰边界，无执行按钮 | inspect/handoff only | static scanner/inspector/runtime allowlist tests | packaged Hybrid 使用内置实现 | 保持 |
| LC-091 | README；用户验证 5 | CLI 包可构建、可执行、版本与应用一致 | COMPLETE | 项目页显示 CLI 路径 | `dist/cli/studio.mjs` | CLI contract；verify-cli tests | 包验证找到 unpacked CLI | 保持 |
| LC-092 | README；用户验证 5 | GUI 中发现包内 CLI 的准确路径且不修改 PATH/Shell profile | COMPLETE | Studio 项目页 | CLI path Main API | StudioProjectView/service tests | `verify-macos-package` 检查路径 | 保持 |
| LC-093 | 用户验证 5/停止条件 | 实际从打包应用路径运行 `studio` 并读取同一 GUI 项目 | COMPLETE | GUI 通过 `--project` 打开同一 fixture | 直接执行 `.app/Contents/Resources/app.asar.unpacked/dist/cli/studio.mjs` | packaged E2E 断言 project/component/revision/Stack/Workflow/任务 | arm64 包实际完成 revision 0→15，GUI/CLI 每段交叉读取 | M14 关闭并持续扩展 |
| LC-094 | 用户验证 5 | arm64 打包 GUI 实际启动并完成核心创建→Stack→冻结→Run 流程 | COMPLETE | 全流程 | Main API | packaged E2E | `e2e-packaged-app.mjs` Hybrid 核心流程与截图 | 保持 |
| LC-095 | 用户验证 5 | 中文主要流程及空、失败、冲突状态有截图复核 | PARTIAL | 中文界面 | N/A | UI tests | 已有设置、能力、组件详情、Adapter/Component/Workflow/Run/Experiment/Agent/Keychain/项目状态截图；M25 新增来源发现安全空状态与本地校验失败并人工复核 | 扩展剩余流程截图矩阵 |
| LC-096 | 用户验证 5 | 扫描 TODO/FIXME/占位按钮/断路导航/mock-only 并逐项分类 | PARTIAL | 无断路导航基准清单 | N/A | 当前 `rg` 扫描仅发现输入 placeholder 与文档历史词 | packaged 未遍历全部导航 | 在矩阵附录固化扫描与可达性测试 |
| LC-097 | 用户停止条件 | 每个冻结需求至少一个自动化证据，用户流程另有 GUI/packaged 证据 | PARTIAL | 见各行 | 见各行 | 当前 MISSING/UNTESTED 为 0；剩余 PARTIAL 仍需逐项关闭 | M25 新增来源发现完整状态自动化与本地确定性 packaged 证据 | 持续收敛剩余 PARTIAL 至 0 |

## 首次冻结审计结论

首次冻结共 97 项。Agent/Component 生命周期、真实 Agent 状态、组件详情、Adapter/Fork 处置链、Workflow 版本化 DAG、Run 历史、Experiment 矩阵、来源发现状态、工作区命令中心、统一状态词汇、迁移恢复、界面偏好、可移植包和 packaged GUI↔CLI 一致已由 M13–M26 逐项关闭；当前为 COMPLETE 87、PARTIAL 5、EXTERNAL-BLOCKED 1、EXPLICITLY-OUT-OF-SCOPE 4，MISSING/UNTESTED 均为 0。剩余 PARTIAL 项继续按冻结行收敛。真实 Multica Transport 单独保持外部阻断；文档明确排除的云端与团队能力不进入本地实现。
