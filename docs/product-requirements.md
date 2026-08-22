# 产品需求文档

## 1. 产品定义

Agent Stack Studio 是一个仅支持 macOS 的本地桌面脚手架。它帮助用户理解并组合 Agent 的实现模块，建立可复现的实验，然后把稳定版本发布到 Multica。

Studio 不承担团队协作平台的职责，也不替代现有 Harness。它负责描述、组合、验证和记录。

Studio 不绑定外部 Coding Agent。Codex、Claude Code、Cursor、自建 Agent、CI 和人工 Shell 都通过同一 `studio` CLI 使用 Studio Core。Agent Loop、Workflow、Hybrid 与 External Harness 是 Stack 的运行时控制模式，不能与外部 Coding Agent 混同。

## 2. 用户问题

现有 Agent 工具常把 Prompt、模型、工具、记忆、上下文、运行循环和 Workflow 打包在一起。用户能够运行它，却难以知道：

- 当前项目已经包含哪些模块。
- 某个模块是否能关闭、替换或独立提取。
- 两个项目同时提供相同能力时应该选择哪一个。
- 替换一个模块后，哪些依赖和实验变量发生了变化。
- 一次实验能否被另一位研究者复现。

## 3. 核心对象

| 对象 | 含义 | 是否可变 |
| --- | --- | --- |
| Agent | 用户管理的长期身份与入口 | 可编辑 |
| Agent Version | Agent 在某个时间点的完整不可变快照 | 不可变 |
| Component | 提供一项或多项能力的实现 | 版本不可变 |
| Stack | 组件、所有权、依赖与配置的组合 | 草稿可变，发布后不可变 |
| Workflow | 一种执行控制方式，可调用 Agent 或普通节点 | 版本不可变 |
| Experiment | 控制变量、实验变量、数据集和评价方法 | 定义可版本化 |
| Run | 一次具体执行及其输入、输出、日志和指标 | 不可变 |
| Connector | Studio 与 Multica 或本地 Harness 之间的边界适配 | 版本化 |

## 4. 信息架构

### 一级导航

- Studio 项目：管理与 CLI 共用的 `.agent-stack`。
- 发现：搜索公开组件来源并生成下载交接。
- Agent：查看和管理本地 Agent。
- 组件：查看所有已发现、已安装和自定义组件。
- 实验：建立控制变量、变量矩阵并比较运行结果。
- 运行：查看正在运行和已结束的本地任务。
- 设置：管理本地路径、密钥、连接器和应用偏好。

### Agent 详情

- 概览：说明、当前版本、运行方式和最近活动。
- Stack：执行模式、组件槽位、所有权、依赖和冲突。
- 能力：面向用户的指令、Skills、MCP、工具、知识和权限。
- 实验：与该 Agent 相关的实验定义和结果。
- 运行：该 Agent 的本地运行记录。
- 设置：名称、环境、密钥引用、导入与发布配置。

组件和实验既有全局页面，也能从 Agent 详情进入经过筛选的上下文视图。

## 5. 关键工作流

### 5.1 导入现有 Agent 或 Harness

1. 用户选择本地目录或已支持的项目类型。
2. Studio 读取清单、依赖、配置和约定文件，不执行未知代码。
3. 扫描器生成候选能力映射，并标记证据和置信度。
4. 用户确认或修正模块归属。
5. Studio 建立 Agent 草稿和首个 Agent Version。

### 5.2 解决组件重叠

假设 X 覆盖 A、B、C、D，Y 覆盖 C、D、E、F、G：

1. Studio 把 C、D 标记为重叠能力。
2. 用户分别决定 C、D 的 Owner 使用 X 还是 Y。
3. Studio 检查依赖、配置和副作用。
4. 必要时生成 Adapter 任务和验证测试。
5. 在验证通过前，Stack 保持“未就绪”。

### 5.3 建立控制变量实验

1. 用户从一个 Agent Version 创建实验。
2. 锁定 A 至 E 及其版本、配置和环境。
3. 选择 F、G 作为变量并定义候选值。
4. Studio 展开实验矩阵，执行预检后运行。
5. 结果按变量组合比较，并明确显示任何非预期变化。

### 5.4 发布到 Multica

1. 用户选择已验证的 Agent Version。
2. Studio 展示将发布的能力、配置引用和运行要求。
3. 用户主动执行发布。
4. Connector 创建或更新 Multica Agent，并保存双方标识映射。
5. Studio 记录发布时间、目标和响应，不承担后续团队权限管理。

## 6. Workflow 与 Agent 的关系

Workflow 不与当前产品逻辑冲突。它属于执行控制层，而不是与模型、记忆并列的普通组件。

支持四种执行模式：

- Agent Loop：由循环控制器驱动模型、工具与上下文。
- Workflow：由有向流程驱动节点。
- Hybrid：Workflow 节点调用 Agent Loop，或 Agent 调用一个 Workflow。
- External Harness：运行逻辑由 Pi、OpenClaw 等外部 Harness 提供。

引用必须绑定不可变版本。系统需要检测直接或间接循环引用。

## 7. MVP 范围

第一阶段必须完成：

- macOS 桌面应用安装和本地启动。
- Agent 列表、创建、导入、详情和版本快照。
- 组件目录、能力槽位、覆盖关系和 Owner 选择。
- 冲突状态、依赖预检和 Adapter 占位任务。
- Agent Loop、Workflow、Hybrid、External Harness 四类执行描述。
- 实验控制变量、变量矩阵、运行记录和基础对比。
- 本地 SQLite 数据库、工作区文件和密钥引用。
- Multica Connector 接口及可验证的首次发布路径。
- 键盘操作、清晰焦点、对比度和减少动画支持。

## 8. 暂不包含

- 团队账号、多人实时协作、云端数据库和远程 Runtime 调度。
- 组件交易市场或公共插件商店。
- 在同一进程中对科研实验进行热替换。
- 自动解决所有第三方代码兼容问题。
- 默认执行未经信任的导入项目代码。
- 通用可视化 Workflow 编辑器。MVP 先支持结构化定义和只读图示。

## 9. 成功标准

- 新用户能在 15 分钟内导入或创建一个 Agent，并看到模块覆盖图。
- 用户能明确选择重叠能力的 Owner，系统不会静默覆盖。
- 用户能锁定至少五项控制变量，只改变两个目标变量并完成实验。
- Run 记录能够说明代码、配置、模型、数据集和 Adapter 是否发生变化。
- 用户能把一个已验证版本发布到 Multica，且本地草稿不会被自动共享。

## 10. M7 项目与 CLI 闭环

- `.agent-stack` v1 承载可移植 Component、Stack、Owner 和不可变 Version，并提供 JSON Schema。
- SQLite 只索引本机项目路径并保存 Run、Experiment、Receipt、Artifact、Multica 映射、路径映射、Keychain 引用、偏好和维护记录。
- GUI 与 CLI 共用 Studio Core，支持 revision 冲突、外部变更刷新、原子写入、迁移和备份恢复。
- 本地组件导入只读取明确安全的静态证据，不执行未知第三方代码。
- 新安装不自动加载三个演示组件；用户可在设置中主动加载，且界面明确说明不调用真实服务。
- M7 使用本地 fixture 仓库完成无网络闭环；GitHub 内建搜索留到 M8。

## 11. M8 GitHub 公开来源发现

- GUI 与 `studio source` CLI 通过同一个 `SourceDiscoveryProvider` 契约搜索、检查和交接公开来源。
- GitHub 只是首个 Adapter，项目文件、Component Descriptor 和 Core 领域类型不绑定 Provider 专用结构。
- 网络访问只由用户或机器调用方主动触发，仅向 GitHub 发送搜索词、分页和排序参数。
- 搜索结果属于 `provider-reported` 元数据，不代表许可证核验、代码审计、契约测试或运行验证。
- 下载交接提供结构化参数数组和安全提示，不由 Studio 执行命令。
- 支持搜索取消、无结果、超时、离线、频率限制、Provider 错误和固定 GitHub URL 白名单。
- M8 不支持私有仓库、Token、GitHub Enterprise、自动 clone 或后台索引。

## 12. M9 安全与发布边界加固

- Electron Session 对浏览器权限、设备权限和下载采用默认拒绝；Window 阻断新窗口、导航和 WebView。
- IPC 白名单除输入输出 schema 外，还必须拒绝非本地应用 Renderer 来源。
- Renderer CSP 默认离线，禁止对象、表单、Frame、媒体、Worker 和不安全脚本来源。
- 打包验证必须读取实际 ASAR，断言编译后 Main 与 Renderer 仍满足安全契约。
- DMG 与 ZIP 必须生成版本和架构明确的 SHA-256 清单，验证器拒绝缺失、多余或哈希不一致的发布物。
- 完整性清单不替代 Developer ID 签名或 Apple 公证；缺少凭证时仍只描述无凭证验证边界。

## 13. M10 项目完整性与审计

- Studio Core 每次读取 `.agent-stack` 时重新计算所有不可变 Version 的快照 SHA-256。
- 审计同时检查版本序号、ID/哈希唯一性、项目归属、来源 revision、组件集合和 Owner 引用。
- CLI 提供只读、非交互的 `studio project audit --json`；失败使用稳定错误码和结构化修复建议。
- GUI 展示同一份 Core 完整性报告，不复制哈希或历史语义判断。
- 自动恢复只能使用已通过相同审计的最后有效备份；无效原文件必须保留并提示人工比较。
- 本地 SHA-256 只证明文件内部一致性，不等于数字签名、作者身份或远端供应链证明。

## 14. M11 Keychain 与发布就绪

- Agent 设置允许新增、替换、检查和删除 macOS Keychain 条目；Renderer 只提交元数据，密钥由 Main 调起的系统隐藏输入接收。加载、空、失败、本机缺失、取消和内联确认都有明确状态与键盘路径。
- Renderer、SQLite、备份、项目版本和 CLI JSON 均不得接收或返回密钥原文。
- `studio secret set` 只从 stdin 读取原文，重复写入同一服务/账户为幂等替换；status/delete 提供结构化机器结果。
- 应用使用正式图标，包验证必须检查最终 Info.plist 与 Resources，而非只检查源码配置。
- 打包应用 E2E 实际启动最终 `.app` 并检查中文设置页和 Renderer 无 Node。架构验证必须区分本机 arm64 与 Intel CI，不声称未执行的真机或 Universal 验证。
- 无 Developer ID、公证凭据或 Intel 真机时，完成无凭据自动化边界并明确记录缺口。

## 15. M12 本地可信运行模式

- Agent Loop、Workflow、Hybrid 与 External Harness 四种模式都能使用 Studio 内置、不可变的可信 Profile 完成本地 Run 和 Experiment。
- Workflow 固化 Version ID 与入口节点；Hybrid 固化 Workflow、Controller 与控制权 handoff；External Harness 固化 Harness Component 并明确 `trustedExecution`。
- Agent Loop、Hybrid、External Harness 缺少 `execution-controller` 时在 Runtime Plan 阶段阻断。
- Runtime 使用精确 Adapter 白名单；仅拥有 `studio://runtime/` 前缀、`user-confirmed` Descriptor 或本地路径均不构成执行许可。
- 所有模式继续冷启动独立 Cordis 子进程，禁止网络，文件系统只允许 Artifact，支持取消、超时、失败和可追溯事件。
- Agent 能力页展示当前 Stack 的能力、Provider、Owner、证据和阻断项，不保留占位页面。

## 16. M13 Agent 生命周期与范围冻结

- Agent 支持复制、归档、恢复和永久删除。复制只复制当前可变身份信息与 Stack 选择，使用全新工作空间，不复制不可变 Version、Run、Experiment、Receipt、映射或 Keychain 引用。
- 现有列表默认排除归档 Agent；用户可以主动进入归档列表查看历史、恢复或请求永久删除。
- 永久删除只能针对已归档且没有 Version、Run、Experiment、Receipt、Multica 映射或 Keychain 引用的 Agent。存在任一历史引用时保留归档状态并明确说明阻断事实。
- 已归档 Agent 的历史详情继续可读，但在恢复前不能创建 Version、启动 Run/Experiment 或发布。
- SQLite v8 增加归档状态；全新数据库、历史升级、失败回滚重试和新版本拒绝读取均由迁移测试覆盖。
- `local-completeness-matrix.md` 与 `release-readiness-matrix.md` 首次冻结 M12 基线的原子需求，后续里程碑只能更新证据/处置或追加既有需求的必要依赖。

## 17. M14 打包 GUI 与 CLI 双向一致性

- 最终 `.app` 支持 `--project <path>` 启动参数，可直接读取打包 CLI 创建或维护的同一 `.agent-stack`。
- 启动参数缺值、重复或歧义时明确拒绝，不扩大 Renderer、IPC 或文件系统权限。
- 项目 watcher 监听父目录中的精确 `.agent-stack` 文件，在 CLI 连续原子替换文件后仍能反复刷新。
- 外部刷新清除已过期的 GUI 成功反馈，页面只表达当前 revision 和 Stack 事实。
- 打包 E2E 使用同一 fixture 完成 CLI 初始化、GUI 打开、CLI 导入与 GUI 外部刷新、GUI 加入 Stack 与 CLI 复核、CLI 移出 Stack 与 GUI 再次刷新。

## 18. M15 分发兼容契约与无凭证 dry-run

- `package.json#version` 继续是 GUI、CLI 和 macOS 包的唯一应用版本来源；机器可读 compatibility manifest 另行绑定项目格式、SQLite schema、IPC、Runtime 和 CLI envelope 版本。
- release config 只允许渠道、HTTPS 下载基址、未来更新地址与签名/公证/staple 强制策略，不包含凭证或业务配置。
- `automaticUpdates` 在 v1 契约中必须为 `false`；可注入 update feed 元数据，但不启动后台更新、网络请求或 Renderer 权限。
- `release:dry-run` 串行质量检查、CLI、macOS 包、包验证和打包 E2E，然后生成不含密钥的 JSON 报告。
- 报告状态区分 `verified`、`skipped`、`blocked`、`disabled` 和 `ready`；无 Developer ID/公证凭证时允许 local dry-run 完成，但不声称已签名或公证。

## 19. M16 本地数据位置与卸载边界

- Main 进程统一解析 Application Support、SQLite、Workspace、Artifact、Recovery 和 Log 路径，Renderer 只读显示路径投影。
- Finder 打开动作只接受受共享 schema 校验的位置 ID，不接受原始路径。
- 安全卸载不自动删除本地数据、外部项目或 Keychain；设置页和分发文档都给出先备份、再卸载、最后手动彻底清理的边界。
- 备份包含 SQLite、Workspace 和 Artifact；Application Support 容器、Recovery、Log 与 Keychain 原文不进入备份。

## 20. M17 本机界面偏好

- 窗口 normal bounds 和最大化状态由 Main 写入现有 `app_preferences`；恢复时验证最小尺寸并丢弃已移除显示器上的离屏坐标。
- 侧栏收起与最后一级页面通过严格视图枚举 IPC 保存；外部启动 hash 优先于已保存位置。
- 偏好合约损坏或版本未知时回退到 1180×760、展开侧栏和 Agent 页，不阻断本地业务数据。
- 界面偏好只属于 SQLite 本机状态，不进入 `.agent-stack`、Runtime 协议、CLI 或 Keychain。

## 21. M18 无密钥可移植 Agent Stack Package

- Studio 项目页和 `studio project export` 使用同一 Studio Core 构建器导出格式 v1 包，不复制项目语义或验证逻辑。
- 包保留经审计的 `.agent-stack` 项目事实和不可变 Version 哈希，并增加应用版本、格式版本、排除清单和整包 SHA-256。
- Keychain 密钥、SQLite 索引、Run、Experiment、Receipt、远程映射、Artifact 和日志不进入包。
- Core 在写入前递归拒绝绝对路径、`file:` URL、带凭据 URL 和带查询参数 URL；不为了导出静默改写历史快照。
- GUI 的保存目标只由 Main 原生对话框选择，Renderer 不提交文件路径；取消、失败、成功与键盘路径都有明确状态。

## 22. M19 真实 Agent 状态

- Agent 列表必须从当前本机事实显示不可变版本、草稿 revision、执行模式、Stack 就绪/阻断、组件与问题数量、最近 Run 结果和最近发布结果，不允许使用固定“草稿”占位。
- Agent 概览使用同一状态定义，并增加 Owner 数量与最近 Experiment；没有对应事实时显示“无版本”“无记录”“尚无实验”或“尚未发布”。
- 最近发布只依据已保存 Receipt。真实 Multica Transport 未配置时保持阻断，不能因为存在目标配置就显示已发布。
- 状态是只读投影。创建 Version、编辑 Stack、运行、实验和发布仍写入各自既有模型；正式分发不需要为概览新增迁移或改写协议。

## 23. M20 组件目录与详情

- 全局组件目录必须支持按名称、Contract ID、能力、兼容等级和来源筛选，并真实显示当前 Agent 草稿使用数量、受影响不可变版本数量和最近验证记录。
- 组件详情必须展示完整 Descriptor 事实：Manifest、来源/许可/平台、提供与依赖能力、替换等级、Adapter/Fork/补丁、配置 Schema 引用、测试证据和受影响 Agent/Version。
- “最近验证记录”不能把 declared 或文件更新时间伪装成新测试；只有 Descriptor 已保存非 declared 验证结论时显示其记录时间。
- 查看详情不会读取 Schema/Adapter 引用目标，不执行组件代码，不改变 Owner 或 Stack，也不授予新的 Runtime 权限。

## 24. M21 版本化 Workflow DAG

- `.agent-stack` v2 把 Workflow 作为可移植事实；草稿含结构化节点与有向边，Version 是内容哈希固定的不可变快照。
- 普通操作、Component、Agent Version 和子 Workflow Version 均有严格节点契约；跨 Workflow 引用必须绑定已存在的不可变 Version。
- Core 在每次保存前拒绝自环、可达回边、悬空节点/Component/Version，以及跨不可变 Workflow Version 的直接或间接循环。
- GUI 提供结构化定义、删除、冻结与只读 DAG 图示；CLI 提供同一 Core 的完整非交互命令。两者共享 project revision、外部刷新和原子写入。
- v0/v1 项目迁移到 v2，迁移失败可恢复，v3+ 拒绝降级读取；项目包同步升级到 v2 并保留 Workflow。
- 项目 Workflow 不因用户定义或冻结而获得 Runtime 信任；执行仍遵守 ADR 0008 的内置 Profile 和精确 Adapter 白名单。

## 25. M22 Adapter/Fork 处置任务与 Component 生命周期

- 当 Descriptor 表明需要 Adapter/Fork 且尚未 `runtime-verified` 时，验证结果必须返回结构化的工作产物、契约测试和最小运行验证任务，而不是只有一行泛化建议。
- 任务必须区分已有证据与待完成项；`contract-tested` 不等于运行兼容，最小运行验证完成前 Runtime Plan 和项目验证保持阻断。
- 任务是 Descriptor 的确定性派生投影，不是新的可移植事实或本机数据库记录。查看任务不能读取引用目标、生成代码、执行测试或授予 Runtime 信任。
- Studio 项目 GUI 与 CLI 必须对同一 Component 完成加入、移出、归档和永久删除；删除有内联确认与取消，expected revision 冲突或历史引用失败时保留组件。

## 26. M23 Run 历史可观测性

- Run 终态一旦写入，历史页只读显示失败原因、Prompt、随机种子、超时、重试/并发和实际总耗时，不提供修改历史的入口。
- 所有复现变量必须来自该 Run 的不可变 Manifest，不能从当前可变 Agent 或 Stack 反推。
- Experiment Run 必须由历史 Manifest 对照实验定义中锁定的控制变量重算 Drift；独立 Run 没有实验基准时明确显示“不适用”，不能伪造 clean 结论。
- Run list 同时显示终态与耗时；成功、超时等不同终态可并存并分别打开。
- 投影沿用现有 Run、Experiment 和 Manifest 事实，不新增 SQLite 列、项目字段、Runtime 消息或可移植包内容。

## 27. M24 实验矩阵可观测性

- 实验详情必须同时显示计划单元、已终态单元、成功与需关注数量、终态成功率和成功单元平均耗时；“已终态”不能被误写为“成功”。
- 复现定义必须持续可见，包括 Prompt 变量数量、随机种子、每组重复次数、单元超时、评价器以及实验开始/结束时间。
- 矩阵必须支持按全部、进行中、成功、需关注状态筛选，并支持搜索 Prompt、种子、Run ID 与失败原因；筛选只改变视图，不修改已保存实验或 Run。
- 失败、取消与 Drift 阻断均属于需关注状态。部分完成仍显示完整计划分母和每个终态原因，不能只展示成功单元。
- 基础对比以第一个 Prompt 与第一个种子的成功平均耗时为基准；没有成功耗时的组合显示无可比值，不能生成误导性的相对指标。
- 实现必须复用既有 Experiment detail、cell、comparison、definition 与 drift 事实；不得为 Renderer 汇总新增 SQLite、项目 Schema、Runtime 消息或 CLI 项目协议。

## 28. M25 来源发现完整状态

- GitHub 公开来源发现必须自动化覆盖首次空闲、加载、成功、有结果、无结果、主动取消、离线、15 秒超时、频率限制与一般 Provider 错误。
- 离线与超时必须使用不同的稳定 Core 错误码；`403/429` 限流不自动重试，一般 Provider 错误也不伪装为网络离线。
- Renderer 必须按失败事实显示恢复动作：本地输入无效时不发网络请求并返回输入编辑；离线、超时、限流与 Provider 错误分别说明对应重试边界。
- Preload 必须对搜索、检查、交接、取消、复制与打开 URL 的错误去除 Electron IPC 内部前缀；Renderer 不显示 `Error invoking remote method`。
- packaged 证据不得依赖 GitHub 可用性：用首次安全空状态和本地输入校验失败证明中文边界、键盘焦点与恢复路径。真实 Provider 行为由 Adapter/Service/Renderer 自动化分层验证。
- M25 不接收 Token、不新增 Provider、不持久化查询、不下载或执行仓库，也不改变项目、数据库、Runtime 或 CLI 项目协议。

## 29. M26 工作区命令中心与统一状态

- 顶栏必须显示当前 Studio 项目名称、revision 与验证状态；没有项目、项目阻断和外部修改都使用明确文字，不能继续显示固定占位工作区。
- 顶栏 Run 状态必须来自已保存 Run 事实，区分活动、完成、需关注和无记录；点击状态可进入对应 Run 历史。
- 全局搜索通过 `⌘K` 或顶栏按钮打开，只检索本机项目、Agent、Component、Run、Experiment 与白名单应用操作，不接受路径、SQL、密钥或网络查询。
- 搜索结果必须支持完整键盘选择和实体直达；加载、无结果、失败与关闭都保留可访问语义和焦点边界。
- 工作区摘要是既有项目与本机记录的只读聚合，不进入 SQLite、`.agent-stack`、Agent Stack Package、Runtime 消息或 CLI 项目协议。
- Agent、Stack、Run、Experiment 与发布状态使用集中化中文词汇；状态始终以文字和图标表达，颜色只作辅助。

## 30. M27 本地验收与可访问入口门禁

- production 源码中的 TODO/FIXME、占位文案、死操作和测试专用成功旁路必须由自动检查拒绝；输入提示与最终包验收控制只能逐项分类。
- 每个一级导航必须同时存在启用的 GUI 入口、实际 Renderer 分支和命令中心目的地，最终 `.app` 必须逐页打开并确认当前页面。
- 最终 Renderer 可访问树必须包含 main/navigation landmarks，一级入口和应用级图标按钮必须有名称；可见按钮不得出现空名称。
- 对比度、可见焦点、减少动态效果与 Dialog 键盘约束必须保留自动化证据；颜色不得成为状态的唯一表达。
- 门禁只验证既有产品入口，不新增测试模式领域事实，也不放宽 Renderer、IPC、Runtime 或密钥边界。

## 31. M28 最终证据台账

- 97 条本地冻结需求和 39 条分发需求必须由同一解析器生成机器可核验报告，不另建第二份手工状态。
- Studio Project、Agent、Component/Stack/Workflow、Runtime/Run、Experiment、来源发现、维护/Keychain 和命令中心必须逐条分类八种验收状态。
- `boundary` 只允许表达只读、单写入或明确职责边界，必须有理由和自动化证据，不能代替缺失实现。
- 中文截图是本地 Git-ignored 打包产物；公开仓库拒绝除已复核图标外的不透明二进制文件。
- 最终 strict 验证必须同时检查零未完成需求、包路径、截图存在性、提交和公开 CI 证据。

## 32. M29 稳定性与敏感信息

- 重复的只读请求不得产生重复 IPC/Provider 工作；重复的发布、恢复、Keychain、取消和维护操作不得产生重复副作用或不同 Receipt。
- 项目迁移、恢复和并发写入必须使用同一排他边界；活跃进程锁不得被误删，死亡进程锁只能在宽限期后回收。
- GitHub、发布 Adapter、Keychain、安全输入和 Runtime 子进程必须有明确超时、输出上限、取消与强制清理路径。
- 日志、工作区、Artifact、备份、恢复和导出默认仅当前用户可读写；备份目的地不得位于被复制的数据树内。
- 凭证 URL、Authorization、Provider token、敏感查询参数和原始子进程输出不得进入项目文件、数据库、Receipt、Artifact、日志、CLI JSON 或 Renderer 错误。
- 迟到的异步响应不得覆盖用户已切换后的 GUI 状态；文件监听、日志和退出清理异常不得导致主进程未捕获异常。

## 33. M30 Agent-first 项目集成

- Agent 是主入口：在同一页完成组件选择、Stack 排序、Owner 冲突决策、兼容性评估、Workflow 与不可变 Version 冻结，然后进入 Run、Experiment 或 Publish。
- 组件库只管理当前项目的可用组件、来源、版本、Descriptor、兼容性、更新与移除；导入成功后 Agent 组装器必须立即可选。
- `.agent-stack` 是 Component Descriptor、Stack、Owner 决策、兼容结论、Workflow 和不可变 Version 的唯一便携事实源。SQLite 只保留本机 Agent 身份/项目版本引用、Run、Experiment、Receipt 和密钥引用。
- 当前项目在全局顶栏显示并可切换；路径、revision、完整性、备份恢复和导入导出收纳到次级“项目设置”，不再作为一级工作台。
- 兼容性评估必须显示未检查、静态通过、需配置、需 Adapter、运行验证通过和不兼容，并附证据、阻断原因、建议动作、时间与方法。Descriptor 编辑不得自动提升证据等级。
- 旧 SQLite Agent/Component 数据必须通过幂等、可恢复的 v9 迁移转为稳定项目/Version 引用；冲突、缺失、混合引用或较新格式必须显式拒绝，不得静默丢数据。
