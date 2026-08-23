# ADR 0018：M37 将旧执行模式、Workflow 与 Experiment 收束为只读或显式迁移

- 状态：已接受，M37 已实施
- 日期：2026-08-23
- 依据：ADR 0011、M32 产品重置、M37 分发迁移收束要求

## 背景

M31 以前的产品可以在普通 GUI 中新建 Agent Loop、Workflow、Hybrid 执行模式，编辑 Workflow DAG，并创建、运行 Experiment。M32 后的产品主路已改为 Native Harness + Component + run/chat/publish。如果新建界面和高级页继续默认写入旧模型，用户会得到两套相互竞争的产品真相；直接删除旧数据又会破坏 M31 兼容承诺。

## 决策

1. GUI 的“创建 Agent”固定写入 `external-harness`，不再显示四执行模式选择。Preload 和 Main IPC 使用 `nativeAgentCreateInputSchema` 再次强制该边界，不依赖 Renderer 正确性。
2. `studio agent create` 只允许 Native Harness Agent。显式传入旧 `--execution-mode` 会返回稳定 `USAGE_ERROR`。`studio project init --execution-mode ...` 作为带 `DEPRECATED_COMMAND` 的兼容迁移入口保留，而不是产品主路。
3. 新项目 Core 默认为 `external-harness`。历史 Agent 可保留当前旧模式并修改名称/说明，或显式迁移到 `external-harness`；不允许在 Agent Loop/Workflow/Hybrid 之间新切换。
4. Workflow GUI 默认只读显示历史 DAG 和冻结 Version。创建、添加/删除节点与边、冻结操作只在用户显式进入“旧版 Workflow 迁移工具”后出现。旧 `workflow` CLI 同样是带弃用提示的显式兼容路径。
5. Experiment GUI 默认只读显示历史定义、矩阵、Receipt 与对比，并保留 JSON/CSV 导出。创建、Drift 刷新、运行和取消只在用户显式进入“旧版 Experiment 迁移工具”后出现。
6. `.agent-stack` v2、SQLite Experiment 表和不可变历史不删除、不重写。本决策收束新写入入口，不把迁移误解为数据丢弃。

## 后果

普通用户只会创建 Native Harness Agent，Harness/组件/run/chat/publish 成为唯一产品主路。历史项目仍可读、可导出、可在显式迁移模式中收尾。未来删除兼容写入前，必须先提供可验证的数据转换和导出路径。
