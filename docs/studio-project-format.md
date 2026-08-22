# `.agent-stack` 项目文件

项目根目录的 `.agent-stack` 是 JSON 文件。当前格式 v2 的机器可读 Schema 位于 [`schemas/project-v2.schema.json`](../schemas/project-v2.schema.json)；历史 v1 Schema 继续保留用于迁移和兼容审计。文件包含项目身份、revision、Component Descriptor 与来源快照、Stack、Owner、结构化 Workflow DAG、不可变 Workflow Version 和不可变项目 Version。

## 事实来源

- 可移植且需要版本控制的定义只写入 `.agent-stack`。
- SQLite 的 `studio_projects` 只索引本机绝对路径、最近 revision/hash 和打开时间。
- Run、Experiment、Receipt、Artifact、Multica 映射、Keychain 引用与维护记录继续由 SQLite 管理。
- 来源绝对路径和 Git 工作树状态属于本机证据；冻结版本会保留证据快照，但不把路径当作跨机器组件身份。

## 写入协议

1. 读取并校验当前文件。
2. 比较调用方 `expectedRevision`。
3. 生成 revision + 1 的完整新文件。
4. 同步同目录临时文件，保存最后有效 `.agent-stack.backup`，再原子替换主文件。
5. revision 冲突时不写入，返回稳定错误 `REVISION_CONFLICT`。

格式 v0 和 v1 会按确定性步骤迁移到 v2；v1 的历史项目 Version 快照不补写字段、不重算原哈希，v2 新冻结的项目 Version 才包含 Workflow 事实。迁移失败会走同一最后有效备份恢复路径；格式高于 v2 时拒绝降级读取和改写。SQLite 备份继续收集应用工作空间内的项目文件，应用外部项目应由用户自己的 Git 或文件备份覆盖。

## Workflow DAG

- `workflows` 保存可变草稿；节点类型为普通操作、Component、Agent Version 或不可变子 Workflow Version。
- 有向边只引用同一草稿中的节点。每次保存校验节点/边唯一性、悬空引用和直接 DAG 循环。
- 子 Workflow 必须绑定已存在的不可变 Version。项目级校验遍历全部 Workflow Version 引用并拒绝直接或间接循环。
- `workflow freeze` 为当前结构生成内容哈希；相同结构幂等复用，后续编辑不改变历史 Version。
- Workflow 草稿或历史 Version 引用的 Component 不能永久删除；项目 Version 快照会携带这些 Component 事实。
- 结构化项目 Workflow 不自动进入可信 Runtime。M12/ADR 0008 的内置 Profile 和精确 Adapter 白名单仍是本地执行边界。

## 可移植导出包

- `*.agent-stack-package.json` 当前格式 v2 的 Schema 位于 [`schemas/agent-stack-package-v2.schema.json`](../schemas/agent-stack-package-v2.schema.json)；历史 v1 Schema 继续随应用分发。
- 包封装通过完整性审计的完整 `.agent-stack`，不取代或回写项目事实文件。
- 包级 `contentHash` 覆盖 Schema、包格式、生成器版本、项目和排除清单。内部不可变 Version 仍使用自己的快照哈希。
- 导出只读取项目文件，不读取 SQLite、Keychain、Run、Experiment、Receipt、Artifact 或日志。任一字符串包含绝对路径、`file:` URL、URL 凭据或查询参数时整体拒绝导出。

## 不可变版本完整性

- 每次读取都对所有 Version `snapshot` 重新计算规范 JSON SHA-256，并与 `contentHash` 比较。
- Core 同时检查版本序号、ID/哈希唯一性、项目归属、来源 revision、快照组件集合与 Owner 引用。
- `studio project audit --json` 使用只读且不自动恢复的路径；失败返回 `PROJECT_INTEGRITY_FAILED`。
- 普通 inspect 和 GUI 可以恢复已通过同一审计的 `.agent-stack.backup`。恢复前保留 `.agent-stack.invalid-*`，GUI 必须提示人工比较。
- 本地 SHA-256 证明快照与已记录哈希一致，但不证明作者身份。能够同时改写快照与哈希的攻击者不在该机制的保证范围内。

## Agent-first 引用边界

一个打开的 `.agent-stack` 项目解释为一个可携 Agent Stack。Component Descriptor、Stack 顺序、Owner 决策、Workflow 和不可变 Version 都由该文件唯一承载；SQLite 只以稳定 Agent ID 引用项目 ID、路径、revision 和不可变 Version ID，不复制项目内容。

`project validate`、`stack validate` 和 Agent 组装器都从同一 Core 计算兼容性评估。评估是可重建的验证结果，不要求用户手工编辑 JSON；外部文件的 revision 与完整性仍在每次写入前复核。

## M31 兼容与生命周期字段

M31 在 v2 内增加 Descriptor `permissions`、`secretReferences`、策略理由/时间，以及 evidence 的 status/method/recordedAt/supersededAt/Artifact/Receipt。Project Component 可选 `auditTrail` 记录导入、静态检查、结构更新、策略、契约测试、运行验证、归档和恢复。这些仍只位于 `.agent-stack`；SQLite 不增加同步副本，Keychain 原文不进入文件。

加法字段都有 schema 上限和严格对象校验。旧 v0/v1/v2 `unknown` 和 `user-confirmed` 记录保持原样；读取投影将其明确映射为“机器证据不足”或“人工决策记录”，绝不升级为契约/运行通过。需要格式迁移时仍保留 `.agent-stack.backup`；高于 v2 的格式继续拒绝读取改写。

Component 归档仅写 `archivedAt` 和审计记录，恢复将其清空。归档 Component 仍保留在历史 Version/Workflow 中；永久删除只能在已归档且无任何当前或不可变引用时发生。
