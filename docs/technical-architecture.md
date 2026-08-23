# 技术架构

## 1. 架构目标

第一版只支持 macOS，采用本地优先的 Electron 桌面架构。界面使用 Web 技术实现，但封装在桌面应用中，不要求用户打开浏览器，也不暴露 localhost 服务。

```mermaid
flowchart LR
    CLI["studio CLI\nAny Shell Agent"] --> CORE["Studio Core\nVendor-neutral Domain"]
    UI["Electron Renderer\nReact UI"] --> IPC["Typed IPC\nAllowlisted Commands"]
    IPC --> MAIN["Electron Main\nApp and OS Integration"]
    MAIN --> CORE
    CORE --> PROJECT["Project .agent-stack\nPortable Definitions"]
    MAIN --> DB["Local SQLite\nLocal Index and Records"]
    MAIN --> FS["Workspace and Artifacts"]
    MAIN --> HOST["Harness Host Driver\nNative CLI / SDK / Process"]
    HOST --> HARNESS["Pi, OpenClaw, Codex CLI"]
    MAIN --> RUNNER["Studio Runtime Process\nCompatibility and Built-ins"]
    RUNNER --> CORDIS["Cordis Kernel\nNot a universal Harness path"]
    MAIN --> CONNECTOR["Multica Connector"]
    CONNECTOR --> MULTICA["Multica"]
```

## 2. 推荐技术栈

| 层 | 选择 | 原因 |
| --- | --- | --- |
| 桌面容器 | Electron | 与 Node.js、Cordis、本地 CLI 和文件系统集成直接 |
| UI | React + TypeScript + Vite | 适合列表、详情、表单和状态密集型桌面界面 |
| 数据校验 | Zod | 统一验证 IPC、清单和配置数据 |
| 本地数据库 | SQLite | 无需服务，易备份，适合单用户本地数据 |
| 数据访问 | 轻量迁移层或 Drizzle | 保持 schema 可迁移和类型安全 |
| 运行内核 | Cordis，锁定版本 | 负责 Service、依赖注入、生命周期和运行时组合 |
| 测试 | Vitest + Playwright | 覆盖领域逻辑、IPC 和主要桌面工作流 |
| 打包 | electron-builder 或 Electron Forge | 生成签名和公证所需的 macOS 安装包 |

具体依赖版本由开发任务在创建工程时锁定，并记录在 lockfile 中。

## 3. 进程边界

### Renderer

- 只负责界面和用户交互。
- `nodeIntegration` 关闭，`contextIsolation` 开启。
- 不能直接访问文件系统、数据库、Shell 或密钥。
- 通过预加载层暴露的白名单 API 调用 Main。

### Electron Main

- 管理窗口、菜单、系统对话框和应用生命周期。
- 执行数据库事务、工作区读写和连接器调用。
- 验证所有 IPC 输入，维护操作审计记录。
- 启动和终止隔离的 Runtime 子进程。

### Runtime Process

- Cordis 运行在独立 Node.js 子进程中，不进入 Renderer。
- 科研 Run 默认使用全新进程，避免热替换残留状态污染结果。
- 每次运行接收不可变的 Run Manifest，只把事件和产物写回 Main。
- 超时、取消和进程崩溃必须被记录为明确状态。

## 4. Cordis 的职责边界

Cordis 从第一阶段进入内核，但不成为产品数据模型，也不再是 M32 起所有真实 Harness 的统一必经运行层。新 Harness 优先使用原生 Host Driver；本节其余职责只适用于 Studio 自有 Runtime、内置生命周期能力和旧版本兼容路径。

Cordis 负责：

- Service 注册和依赖解析。
- 插件注入和生命周期管理。
- Fiber 或 Effect 范围内的启停与清理。
- 运行时配置分发。

Studio 负责：

- Agent、Component、Stack、Experiment、Run 等领域模型。
- 能力覆盖、Owner 选择、冲突和兼容性状态。
- 版本、审计、复现和用户交互。
- 把已验证的 Agent 编译为 Harness 原生配置或仅在确有需要时编译为 Cordis Runtime Plan。

这不是重新实现 Cordis。领域模型回答“用户组合了什么以及为什么”，Host Driver 回答“目标 Harness 如何原生执行”，Cordis 只回答 Studio 内部服务如何实例化、依赖和销毁。Studio 不实现第二套通用依赖注入容器，也不发明覆盖全部 Harness 的运行协议。

第三方组件不直接暴露 Cordis 类型。Adapter 把稳定的 Studio Component Contract 转换为内部 Cordis Service。这层边界用于控制 Cordis API 变化和第三方耦合，不负责重复实现 Cordis 的运行能力。

## 5. Cordis 风险控制

- 锁定经过验证的 commit 或维护内部镜像，不跟随未评估升级。
- 为 Service 生命周期、错误恢复和 disposer 编写契约测试。
- 不把 Cordis 的热替换等同于外部副作用回滚。
- 未知组件在独立进程运行，后续再增加更强沙箱。
- 服务键使用命名空间和版本，避免不同组件发生隐式覆盖。
- 每次 Run 冷启动，记录 Cordis 版本和 Runtime Plan 哈希。

## 6. 数据与文件

建议的数据位置遵守 macOS Application Support 约定：

- SQLite：Agent、版本、组件元数据、实验定义、运行索引。
- Workspace：用户可查看的清单、生成的 Adapter、Workflow 和导出包。
- Artifacts：日志、轨迹、指标和运行产物。
- Secrets：优先存入 macOS Keychain，数据库只保存引用标识。

用户应能导出一个不包含密钥的可移植 Agent Stack Package。

## 7. 插件与组件加载

每个 Component Package 至少包含：

- Manifest：身份、版本、来源、许可、入口和支持平台。
- Capability Descriptor：提供和占用的能力。
- Configuration Schema：用户可配置项和敏感字段声明。
- Runtime Adapter：转换为 Cordis Service 或外部 Harness 调用。
- Health Check：静态预检和可选运行验证。

导入扫描分为静态扫描与可信执行。默认只做静态扫描；需要执行项目脚本时必须明确提示用户。

## 8. Workflow 执行

Workflow 是版本化 DAG。节点可以是普通操作、组件调用、Agent Version 或子 Workflow Version。

- 保存时检查循环引用。
- 执行前把 DAG 编译成 Runtime Plan。
- Hybrid 模式必须标出 Agent Loop 与 Workflow 的控制权切换点。
- Workflow 变化属于实验变量，除非它被明确锁定。

## 9. 安全基线

- Electron 启用上下文隔离，禁用 Renderer Node 权限和不安全远程内容。
- IPC 使用白名单命令和 schema 校验，不提供任意 Shell 接口。
- Shell 调用使用参数数组，不拼接命令字符串。
- 密钥不进入日志、Run Manifest、导出包或 Renderer 状态。
- 本地目录访问经由用户选择或受控工作区授权。
- 发布 Multica 前展示数据范围，并要求用户主动确认。

## 10. 可测试性

- Domain 层测试能力覆盖、Owner 决策、冲突和实验锁定。
- Runtime 契约测试 Cordis 生命周期、取消、超时和清理。
- Connector 使用录制样例或测试环境验证，不在单元测试访问真实账号。
- Playwright 覆盖创建 Agent、解决冲突、建立实验和发布预检。
- 每个 PR 或自动推送分支必须通过类型检查、单元测试和构建检查。

## 11. M6 数据升级与恢复边界

- 备份和恢复由 Main 侧 `DataMaintenanceService` 执行，Renderer 只能通过经 Zod 校验的白名单 IPC 发起原生目录选择、预检和明确恢复。
- SQLite 备份使用在线 backup API 生成一致性快照，不直接复制可能仍有 WAL 写入的数据库文件。
- 备份清单固化格式版本、应用版本、数据库 schema 与每个数据文件的 SHA-256。日志、Keychain 密钥原文与符号链接被结构化排除。
- 恢复先复制到 Application Support 内的待恢复区。应用重启后，在任何 Repository 打开前生成自动回滚备份，然后替换 SQLite、Workspace 和 Artifacts；文件级失败会回滚。
- 恢复的旧 schema 通过既有事务式迁移链升级。如果数据库 schema 高于当前应用支持版本，启动直接阻断，不执行隐式降级。

## 12. M7 Studio Core 与双入口

- `src/core` 不依赖 Electron Renderer，并由 Electron Main 与 `studio` CLI 共用。验证、Owner、删除保护和版本冻结不能在适配层复制。
- `.agent-stack` 是可移植定义的唯一可编辑事实来源；SQLite v7 的 `studio_projects` 只保存路径和观察元数据。
- Renderer 仍只通过 Zod 校验的 Preload 白名单访问项目操作。文件选择、监视和 CLI 路径发现由 Main 管理。
- Core 使用 revision 乐观并发、同目录原子替换和最后有效备份。外部文件变化触发 GUI 重新读取。
- CLI 构建与应用共享 `package.json` 版本，应用只展示可执行路径，不写 PATH 或 Shell profile。

## 13. M8 来源发现边界

```mermaid
flowchart LR
    USER["用户或 Coding Agent"] --> ENTRY["GUI / studio source"]
    ENTRY --> CONTRACT["SourceDiscoveryProvider"]
    CONTRACT --> GH["GitHub Public REST Adapter"]
    GH --> META["Provider-reported Metadata"]
    META --> HANDOFF["Review-required Handoff"]
    HANDOFF -. "Studio 不执行" .-> SHELL["人工 Shell / Coding Agent"]
    SHELL --> LOCAL["本地仓库"]
    LOCAL --> SCAN["M7 Static Inspector"]
```

- `src/core/source-discovery.ts` 只定义 Provider 接口和下载交接格式；GitHub 网络字段由 `src/adapters/github` 映射为共享来源类型。
- Electron Main 与 CLI 各自实例化同一个 GitHub Adapter。Renderer 只能通过 Zod 校验的搜索、检查、交接、取消、复制和 GitHub URL 白名单 IPC 操作访问它。
- Adapter 只访问固定 GitHub 公共 API，使用固定版本头、超时、ETag 和 rate-limit 响应头。请求不自动重试，不并发轮询。
- 查询与结果不持久化。下载交接是数据，不是执行许可；只有本地目录经过 M7 静态导入后才能成为项目 Component。

## 14. M9 默认拒绝与发布完整性

- `src/main/security` 集中管理 Electron Session 与 WebContents 的默认拒绝策略。全局沙箱在 `ready` 前启用，窗口安全参数全部显式声明。
- Session 拒绝 permission check、permission request、设备访问和下载；WebContents 拒绝新窗口、导航和 WebView。未来例外必须按最小权限单独设计。
- IPC Handler 在 schema 校验前验证 Sender Frame 仅来自本地 `file:` Renderer；Preload 暴露能力仍由现有频道白名单限制。
- Renderer CSP 不允许网络连接、远程脚本、对象、表单、Frame、媒体或 Worker。GitHub 请求继续只发生在 Main/CLI Adapter。
- macOS 包验证直接读取 `app.asar` 中的 Renderer HTML 与 Main 构建，随后按发布清单重算 DMG/ZIP SHA-256。该校验补充但不替代 Developer ID 和 Apple 公证。

## 15. M10 项目历史完整性

- `src/core/project-integrity.ts` 是 GUI、CLI 和 ProjectStore 共用的唯一历史审计实现。
- ProjectStore 在结构/schema 迁移后、返回项目状态前重算每个 Version snapshot 的 SHA-256，并检查版本序列、项目归属、来源 revision、组件集合与 Owner 引用。
- `project audit` 使用 `recover: false` 的只读读取；普通 inspect/GUI 可以按既有边界恢复最后有效 `.agent-stack.backup`，但必须保留无效原件并显示恢复状态。
- `ProjectIntegrityReport` 经共享 Zod schema 进入 Preload/Renderer；Renderer 只负责表达结果。
- 哈希覆盖 Version snapshot；Version ID、创建时间等外层元数据受结构和语义约束，但 M10 不提供密码学身份认证。

## 16. M11 Keychain 与最终应用 E2E

- `src/adapters/keychain` 使用固定系统二进制 `/usr/bin/security` 和参数数组；提示响应经 stdin 发送，密钥不出现在 argv。
- `SecretService` 协调系统钥匙串与 SQLite 引用。Renderer 只提交用途与账户；Main 通过固定 AppleScript 调起 macOS 原生隐藏输入，再直接写入 Keychain。状态对象不含原文，`readForRuntime` 只留在 Main 受信边界。
- `studio secret set` 必须声明 `--stdin`，机器 envelope 只返回 service、account 和状态。CLI 与 GUI 使用相同服务/账户时观察同一个本机条目。
- 正式 `.icns` 由 electron-builder 写入应用包；发布验证读取 Info.plist 并检查实际 Resources。
- `test:e2e:packaged` 只在测试启动参数中开放本机 DevTools 端口，直接检查打包 Renderer、中文设置页和截图。正常应用启动不监听端口。
- GitHub `macos-15-intel` runner 负责 Intel 构建契约，本地 Apple Silicon 负责 arm64。两个架构分别生成产物和哈希；当前不生成 Universal Binary。

## 17. M12 本地可信执行 Profile

- `src/shared/trusted-execution.ts` 保存内置 Workflow Version、入口节点、用户可见模式说明和精确 Runtime Adapter 白名单。白名单只接受完整引用，不接受命名空间前缀匹配。
- Main 在创建 Run Manifest 前解析执行模式并验证所有激活 Service 的 Adapter。未注册 Adapter 在创建 Run 记录前失败，不能先排队再由 Runtime 异步报错。
- Workflow 使用内置线性 Profile；Hybrid 固化 `workflow-to-agent` handoff；External Harness 只允许内置 Harness X Controller。绑定标识进入 Manifest 内容哈希。
- Runtime 根据 Manifest 中的判别联合执行四种内置路径，仍只处理结构化数据，不 `import`、`spawn` 或调用导入组件代码。
- Agent Loop、Hybrid 与 External Harness 的 Runtime Plan 必须提供 `execution-controller`。能力页面直接展示编译器返回的同一 Stack 状态。

## 18. M13 Agent 生命周期边界

- Agent 长期身份、归档状态及其 Run/Experiment/Receipt 等本机关系继续位于 SQLite；不得为了增加生命周期操作把 Agent 身份复制进只承载 Component、Stack、Owner 和 Version 的 `.agent-stack`。
- `AgentService` 是 Main/API 的生命周期边界。复制在事务内复用当前 Stack component/owner 选择，但创建全新 ID、revision 1 和工作空间，不复制任何历史或密钥引用。
- 永久删除前由 Repository 在同一数据库连接上检查所有历史引用；SQLite 外键继续作为第二道完整性保护。文件工作空间只在数据库删除成功后清理。
- 归档状态进入共享 Zod 与 IPC 白名单。Run、Experiment、Publish 和 Version 创建统一调用 active-Agent guard，Renderer 不复制这一判断。
- v8 迁移只增加可空 `archived_at` 与索引，保证既有 Agent 默认为 active；失败迁移事务回滚后可以在修复冲突后重试。

## 19. M14 项目启动与外部刷新契约

- Electron Main 在创建 Renderer 前解析唯一的 `--project <path>`，并调用 `StudioProjectService.open`。路径不经 Renderer 或 IPC 传递。
- 启动项目、原生选择器打开的项目和 CLI `--project` 都进入同一 Studio Core/ProjectStore，不引入第二份领域或验证逻辑。
- ProjectStore 继续通过同目录临时文件和 rename 原子替换 `.agent-stack`。Main 监听父目录并精确过滤目标文件名，避免 watcher 绑定到被替换的旧 inode。
- 每次外部修改重新读取共享 schema、完整性和 revision；哈希未变时不发送冗余 Renderer 通知。
- packaged E2E 不用 mock Core 或 mock CLI，直接调用 `.app` 内可执行 CLI 并通过 Chromium CDP 操作最终 Renderer。

## 20. M15 纯分发层契约

- `config/release-compatibility.json` 是分发兼容清单，不是项目文件、数据库表或 Runtime Manifest。它只记录已有契约的版本和职责边界。
- 应用版本不在 compatibility manifest 中复制，而是显式指向 `package.json#version`。自动化测试将项目常量、JSON Schema、SQLite schema、Bundle ID 和最低 macOS 与清单对齐。
- `config/release.default.json` 通过 `schemas/release-config-v1.schema.json` 与 Zod 双重表达。环境只能覆盖渠道、URL 和三个 Apple 要求布尔值；凭证仍只由 electron-builder/Apple 工具读取。
- 非 local 渠道没有 HTTPS 下载基址时 dry-run 阻断。公证要求依赖签名，staple 要求依赖公证，无效组合在打包前拒绝。
- compatibility、默认 release config 和其 JSON Schema 作为分发元数据进入 ASAR；包验证逐字节与源文件对比。

## 21. M16 数据位置契约

- `DataMaintenanceService` 持有从 `app.getPath('userData')` 派生的全部内部路径，状态投影显式标记用途、文件/目录类型和是否进入备份。
- Renderer 不拼接、不选择、不读写这些路径。`maintenance:reveal-data-location` 只接受严格位置 ID 枚举，Main 再映射为 Finder 动作。
- 不新增自动卸载或删除 IPC。Application Support、外部 `.agent-stack` 和 Keychain 条目的移除是用户明确的分步手动操作。

## 22. M17 应用偏好契约

- `ApplicationPreferencesService` 在 Main 内使用已有 v7 `app_preferences` 表，以 `contractVersion: 1` 的 Zod 契约读写窗口、侧栏和最后视图；未知/损坏值整体回退默认。
- BrowserWindow 保存 `getNormalBounds()` 而非最大化后的物理边界，并单独保存 maximized。启动时与当前 display work area 求交，至少 100×100 可见才恢复 x/y。
- Renderer 只能提交 `sidebarCollapsed` 和 `lastView` 完整对象，不能修改窗口坐标、数据库 key 或任意 JSON。

## 23. M18 Agent Stack Package 契约

- `src/core/agent-stack-package.ts` 是 GUI 与 CLI 共用的唯一构建、便携性审计、哈希验证和原子写入实现。
- `schemas/agent-stack-package-v2.schema.json` 封装完整 `.agent-stack` v2 项目事实、`package.json#version` 应用版本、显式排除清单和 SHA-256；v1 Schema 作为历史读取边界保留，当前包格式版本进入 release compatibility manifest。
- 导出使用 `recover: false` 读取，因此不会把未审计的损坏项目或失败恢复结果包装成可分享事实。
- 完整项目快照在导出时原样保留，确保 Version `contentHash` 继续可验证。便携性审计发现本机路径或敏感 URL 时拒绝导出，不重算或改写旧 Version。
- Main IPC 只接受空输入，导出路径由原生 Save Dialog 决定；Preload 和 Renderer 只获得经 Zod 校验的导出回执。

## 24. M19 Agent 状态投影契约

- `AgentStatusService` 是 Main 内的只读应用服务，按 Agent ID 组合 `AgentService`、`ComponentService`、`RunService`、`ExperimentService` 与 `PublishService` 已有事实。
- 投影不进入 SQLite、`.agent-stack`、Version 快照、Runtime Manifest 或发布包；它没有迁移，也不能成为新的事实来源。
- 列表与详情分别通过 `agent-status:list` 和 `agent-status:get` 暴露同一严格共享 Schema。输入只允许归档范围或 Agent UUID，不接受路径、数据库位置、查询表达式或密钥字段。
- 最近 Run/Experiment 使用各自按创建时间倒序的 Repository 结果；最近发布跨允许目标比较 Receipt 完成时间或创建时间。没有 Receipt 时明确为未发布，未配置的真实 Multica Target 不构成发布事实。
- Renderer 在进入概览和返回列表时重新读取投影，保证长时间 Run 后不会继续显示旧快照；既有领域写操作及 `agents.list` 契约保持不变。

## 25. M20 组件目录与详情投影契约

- `ComponentCatalogService` 只组合 `ComponentService.list/getStack` 与 `AgentService.list/get`。当前使用方来自 Stack 草稿；受影响版本来自不可变 `AgentVersion.snapshot.stack.components`。
- 投影不写回 Component Descriptor、Agent、Version、SQLite 或项目文件，不引入新的“使用关系”或“验证事件”表。
- `validationRecord.recordedAt` 只在验证状态不是 `declared` 时使用 Component 记录的 `updatedAt`，含义是“当前验证结论的记录时间”，不是重新执行测试的时间。declared 返回 `null`。
- `components:catalog` 不接受输入；`components:get` 只接受严格 UUID。Main 输出统一经 `ComponentCatalogItem` Zod Schema 复核，Renderer 不能传数据库、路径或执行参数。
- Descriptor 的 source、runtimeAdapter 与 configSchema 仅作为只读引用展示。目录/详情不会读取引用目标、加载 Adapter、解析任意 Schema 文件或执行来源代码。

## 26. M21 Workflow 与项目格式 v2 契约

- `project-model.ts` 是 Workflow 草稿、节点、边、不可变 Version 与项目格式 v2 的唯一领域 Schema；SQLite 不复制这些可移植事实。
- 草稿内 DAG 校验使用可达性检查，在原子写入前拒绝自环和回边。项目 Schema 另以 Version ID 图遍历跨 Workflow 引用，拒绝直接或间接循环及不匹配的 Workflow/Version 对。
- Workflow Version 和项目 Version 分别维护 SHA-256；项目完整性审计同时复算 Workflow Version，Component 删除检查草稿与历史 Workflow 引用。
- ProjectStore 支持 v0→v1→v2 语义迁移、失败备份恢复和 v3+ 前向拒绝。v1 历史项目 Version 快照允许缺少 `workflows`，从而保持原哈希不变。
- `StudioCore`、CLI、Main Service、Zod IPC、Preload 与 Renderer 共享同一写路径和 expected revision。Renderer 仍无 Node、文件系统或数据库访问。
- Agent Stack Package 同步升级到 v2，兼容清单把 `workflows` 列为 portable fact；最终包同时携带 v1/v2 Schema。
- 结构化 Workflow 目前是编排事实与版本输入。它不会绕过 ADR 0008：Runtime 只执行内置可信 Workflow Profile，未知项目节点不被加载或执行。

## 27. M22 派生处置任务与 Component 生命周期

- `src/shared/remediation.ts` 定义严格 Zod Schema 和纯函数。Main Runtime Plan 编译器与 Studio Core 项目验证传入相同的 Component ID、名称和兼容结论，得到确定性的相同任务链。
- `runtimePlanCompilation` 与 `projectValidation` 把 `remediationTasks` 作为即时输出；`.agent-stack` v2、Agent Stack Package v2、SQLite v8 和 Runtime Plan v1 均不增加持久化字段。
- CLI 的 `project validate` 在稳定 JSON data 中返回完整任务，并把待完成项投影为 suggestedActions；Renderer 通过既有严格 IPC 输出读取，不新增路径或执行 IPC。
- `contract-tested` Adapter 仍产生一项 required 的 `runtime-validation`。只有 Descriptor 已为 `runtime-verified` 时任务链为空并允许兼容性检查通过。
- Component 删除继续由 Studio Core 同时检查 Stack、项目 Version、Workflow 草稿和 Workflow Version 引用；GUI 取消只改变本地视图状态，不调用 IPC。

## 28. M23 Run 历史投影契约

- `RunHistoryService` 是 Main 内的只读应用服务，组合 `RunService` 的 Run/事件/Artifact 与 `ExperimentService` 的已保存定义和单元关联。
- Prompt、随机种子、超时、重试、并发和执行控制快照只读取不可变 Run Manifest；耗时由已保存的 `startedAt` 与 `finishedAt` 计算。
- 关联 Experiment 时，服务用 Run Manifest 构造当次控制快照，并与实验定义中的锁定控制变量调用同一 `checkDrift` 纯函数。它不读取当前 Stack，因此后续编辑不会改写历史结论。
- 独立 Run 返回 `experiment: null`。共享 Schema、Preload 和 Renderer 必须将其表达为 Drift 不适用，不能将缺失基准序列化为 clean。
- `runs:get` 与 `runs:cancel` 输出经严格 `RunHistoryDetail` Schema 复核；输入仍只允许 Run UUID。该投影不增加 SQLite 迁移、项目格式、Runtime 协议或 CLI 项目协议字段。

## 29. M24 实验矩阵只读派生契约

- `ExperimentDetail` 仍是矩阵页面唯一输入，包含不可变定义、Drift 结果、已保存 cell 与基础 comparison；M24 不增加新的 IPC 方法或输出字段。
- Renderer 只从 cell 状态计算计划数、终态数、成功/需关注数、终态成功率和成功平均耗时。终态集合固定为 `succeeded | failed | cancelled | blocked`，需关注集合固定为 `failed | cancelled | blocked`。
- 状态筛选和文本搜索只作用于内存中的已保存 cell，不触发写 IPC，不改变运行顺序、取消语义或历史记录。
- 相对基线继续由 Experiment 服务按第一个 Prompt/第一个 seed 的成功耗时生成；Renderer 只呈现 comparison，不重算领域比较规则。
- 该切片不改变 SQLite v8、`.agent-stack` v2、Agent Stack Package v2、Runtime Plan/子进程消息、CLI 项目命令或兼容清单。正式分发只需携带同一 Renderer 与既有契约。

## 30. M25 来源发现失败边界

- GitHub Adapter 保留固定 15 秒超时，并将调用方 Abort、Adapter 超时、网络失败、限流、查询错误和 Provider 错误映射为不同的 `StudioCoreErrorCode`；默认请求仍不重试。
- `DISCOVERY_TIMEOUT` 只在 Adapter 自身的 timeout signal 触发时返回；用户取消优先保持 `OPERATION_CANCELLED`，离线或连接失败保持 `DISCOVERY_NETWORK_FAILED`。
- Preload 的六个 discovery 白名单方法统一使用相同错误净化入口，移除 Electron invoke 前缀后才交给 Renderer；输入与成功输出继续分别经过原有 Zod Schema。
- Renderer 的失败展示是临时 UI 状态，不写 SQLite、`.agent-stack`、日志或查询历史；本地少于两字符的校验在 IPC 前完成。
- packaged E2E 只触发本地校验，不让 CI 成功取决于 GitHub 网络。Provider 的 HTTP/timeout/network 语义由注入 Fetch 的 Adapter tests 验证，不引入产品 mock 开关。

## 31. M26 工作区命令中心只读聚合契约

- `CommandCenterService` 只组合 `StudioProjectService`、`AgentStatusService`、`ComponentCatalogService`、`RunService` 和 `ExperimentService` 的既有事实；纯 Core 函数负责摘要、索引、排序与搜索。
- `command-center:snapshot` 不接受输入；`command-center:search` 只接受最长 100 字符的严格查询对象。Main 输入和输出、Preload 输入和输出均经共享 Zod Schema 复核。
- 搜索目的地是显式 discriminated union，仅允许既有页面、实体 UUID 和固定应用动作；不接受路径、URL、数据库表达式、Runtime 参数或密钥字段。
- Renderer 以 3 秒只读刷新投影，活动 Run 时缩短为 500ms；项目外部修改通知会立即刷新。摘要失败不阻断既有页面和本地编辑流程。
- 命令中心不产生数据库迁移，不改变 `.agent-stack` v2、Agent Stack Package v2、Runtime Plan/子进程协议、CLI 项目命令或 release compatibility manifest。

## 32. M27 本地验收门禁契约

- `config/local-acceptance.json` 是验收分类清单，不是产品配置或发布兼容事实；它只列出一级导航、带用途的输入提示和最终包控制。
- `verify-local-acceptance.mjs` 扫描 tracked 与 prospective untracked production 源码，拒绝未处置工作标记、占位/死操作、未分类 harness 和导航契约断裂。
- packaged E2E 使用 CDP Accessibility domain 读取最终 Renderer 的可访问树，并真实点击全部一级导航；它不注入 IPC 结果或替换 Core/Runtime。
- M27 不增加 IPC、数据库迁移、项目/包 Schema、Runtime 消息或 CLI 行为；正式分发继续携带相同业务产物。

## 33. M28 证据图与最终报告契约

- `config/final-evidence.json` 只存放需求/流程/证据引用和预期产物，不进入 Electron 应用包的运行配置或领域输入。
- `evidence-ledger.mjs` 解析两张 Markdown 矩阵为唯一状态来源，验证连续 ID、状态词表、自动化引用、八状态完整性、截图 producer 和外部阻断白名单。
- 报告生成器只读 Git HEAD、矩阵、manifest 和本地产物；输出到被忽略的 `release/`，不将本机绝对路径写回项目事实。
- 公开 snapshot 门禁对不透明二进制采取默认拒绝，仅允许 `build/icon.icns` 与 `build/icon.png`；本地截图不可被 Git 跟踪。
- M28 不增加 Studio Core、IPC、Preload、Renderer 业务、SQLite、项目/包 Schema、Runtime 协议或 CLI 行为。

## 34. M29 稳定性与敏感诊断契约

- Main 进程使用单实例锁和 `077` umask；项目写入、迁移和恢复共享同一排他锁，锁文件含进程与随机令牌，只能回收已死亡进程且超过宽限期的锁。
- Preload 只合并完全相同的只读 IPC；任何写操作开始和结束时都清空合并表。Renderer 用递增请求序号拒绝晚到响应覆盖新状态。
- 发布预检/提交、恢复 staging、Keychain locator、维护对话框和来源发现各自使用确定性的单航班或串行队列；不同恢复来源不得共享结果。
- 所有外部或子进程边界必须有超时、输出上限、AbortSignal 和受控强制清理；Runtime stdout/stderr 正文不进入主日志。
- `sensitive-data.ts` 是日志、CLI、IPC 与 Runtime 诊断净化的共享实现；凭证 URL、Provider token、Authorization 和敏感字段必须在持久化或跨边界前被拒绝或替换。
- M29 不改变 SQLite v8、`.agent-stack` v2、Agent Stack Package v2、Runtime Plan/消息或 CLI 项目命令，正式分发无需重写业务路径。

## 35. M30 单一便携事实源与 Agent 引用契约

- `.agent-stack` v2 继续是项目便携事实文件；M30 收回了 Component/Stack/Owner/Version/Workflow 在 SQLite 的正常读写路径，不新建同步层。
- SQLite v9 新增 `agent_project_links`，以稳定 Agent ID 引用项目 ID、路径和当前不可变项目 Version；Agent Version 可保存 `project-reference`，但运行/发布前必须从对应项目快照在内存中实体化并再校验。
- 主进程的 `StudioProjectService` 是 GUI 投影与本机引用的编排器；GUI 和 CLI 共用 Studio Core 的项目读写、revision、完整性、Descriptor、Stack、Owner、Workflow 和冻结逻辑。
- `CompatibilityAssessment` 是 Core 的可解释派生结果，根据 platform、entrypoint、capability contract、config/permission/secret 需求、能力冲突、Adapter 契约和证据等级评估；Renderer 不自行推断。
- 运行验证只能通过已受信的精确 Runtime Adapter 白名单进入独立子进程，沿用超时、取消、强制清理、日志脱敏、Artifact 和 Receipt 边界；未知项目的静态检查不执行代码。
- 启动迁移先写经 Core 验证的项目与 `.agent-stack.migration-backup`，再以单一 SQLite 事务写入引用并清理可携副本。任一步失败均可幂等重试；无法无损归属的孤立数据安全停止启动。

M30 明确取代上文 M29 “SQLite v8 不变”的时点性描述；项目/Package 格式仍为 v2，Runtime 消息与 CLI 项目命令保持兼容。

## 36. M31 兼容证据管线

- `CompatibilityAssessment` 保持 Core 派生投影，但 `suggestedActions` 改为严格结构，Renderer 只映射到白名单按钮、表单或外部步骤，不自行推断兼容性。
- Descriptor 写入边界把 validation/evidence 视为系统专用字段；Renderer 或 CLI 提交的同名值被 Core 丢弃。结构、能力、依赖、配置、权限、密钥引用、Adapter 或策略改变会把当前契约/运行证据标记 `supersededAt`。
- 确定性契约测试仅读取经 schema 验证的 Descriptor，生成内容哈希、Receipt ID、方法和时间，不 import 项目代码。受信运行验证要求前置契约通过和精确 `trustedRuntimeAdapterRefs` 命中。
- Main 为每个 Component 保持单航班 `AbortController`，子进程只接收 component ID、contract ID/version 和白名单 Adapter 引用。子进程中 Cordis 内核真实启动内置 Adapter 生命周期；超时/取消先协作通知，有界宽限后 `SIGKILL`。stdout/stderr 被丢弃，仅严格 Receipt 跨 IPC。
- 归档/恢复、复查、契约测试与运行验证经同一 Studio Core 暴露给 CLI 和 schema-validated Main IPC/Preload。Renderer 仍无 Node/FS/DB/Keychain 权限。
- M31 对 `.agent-stack` v2 作加法型字段扩展，不增加 SQLite 副本，不暴露 Cordis 类型。历史 unknown/user-confirmed 依旧可读并显式映射为非技术证据。

## 37. M32–M37 Native-first Studio Core

```mermaid
flowchart LR
    GUI["Electron GUI"] --> CORE["Studio Core"]
    CLI["studio CLI"] --> CORE
    CORE --> FACT[".agent-stack + revision"]
    CORE --> PLAN["Install / Run / Publish Plans"]
    PLAN --> MAIN["Main or CLI Host Boundary"]
    MAIN --> DRIVER["Versioned HarnessHostDriver"]
    DRIVER --> NATIVE["Harness Native Entry"]
    MAIN --> CONNECTOR["Multica Connector"]
```

- Core 新增 Harness Manifest、Capability Matrix、安装方案、聊天/运行请求、冻结发布物和诊断结果等厂商无关领域类型；它们不得引用 Cordis、Electron、具体 CLI argv 或 Multica 内部类型。
- Host Driver Registry 是代码内精确注册表。Driver 只有在版本、平台、原生入口和能力矩阵匹配时可执行；前缀、项目字段或用户确认不能授予执行权限。
- GUI 与 CLI 先向 Core 请求确定性 Plan，再由 Main/CLI Host 执行操作系统动作并把严格结果交回 Core。Renderer 仍只通过 Zod IPC 使用该能力。
- `.agent-stack` 的格式升级必须保留 M31 v2 的 Component/Stack/Owner/Workflow/Version 事实并提供幂等迁移；SQLite 只保存本机会话、Run、Receipt、路径索引和密钥引用。
- 人类 Chat 允许 TTY 交互；非交互 Run 不读取 TTY。两者共享 Harness 配置编译、权限、取消、超时、输出上限和脱敏逻辑，但会话历史不进入发布 payload。

### 37.1 M33 Native Agent 执行切片

M33 的 GUI 与 CLI 都调用 `NativeAgentCore`。Core 从项目当前 `execution-controller` 的内置 `studio://host-drivers/*` 引用解析 Driver；Renderer 不能提交 executable、argv、工作目录或凭证。Main 为 GUI 注入当前项目，CLI 只接受项目根路径和经过 schema 校验的产品参数。

Agent Profile 是 `.agent-stack` 的新增向后兼容字段，包含 instructions、Markdown memory、skills、MCP server references 和 tool policy。旧项目读取时获得空 Profile；旧不可变 Version snapshot 不会因默认字段注入而改变哈希，新冻结版本显式包含 Profile。

Native Chat/Run 结果写入项目旁的 `.agent-stack-local/native-history.jsonl`，使用独立文件锁和 `0600` 权限，并被 Git 排除。该历史包含消息结果，因此不会进入项目版本、Agent Stack Package 或后续 Multica payload。非交互 Run 的 idempotency key 在此本机域内去重，不改写项目 revision。

测试期可按 ADR 0020 显式启用 loopback Codex simulation：真实 Pi/OpenClaw CLI 仍由各自 Host Driver 启动，但模型请求进入只监听 loopback 的 OpenAI-compatible 代理，再由隔离、只读、ephemeral 的 `codex exec` 响应。Pi/OpenClaw 配置写入 `.agent-stack-local` 下的独立状态目录，Harness 工具全部禁用。结果 Schema 记录 `modelLayer`，GUI/CLI 不得把 simulation 表述成 Harness 原生 Provider 认证；默认生产路径不启用该环境开关。

Driver 进程统一使用 `shell: false`、受限输出缓冲、进程组取消和超时后的强制清理。Pi Driver 使用固定 `0.84.2` JSONL/session/Skill 参数；OpenClaw Driver 保留 `agent --local` 原生 session，并仅在新版且请求类型为 Run 时使用隔离 `agent exec`。能力降级按 ADR 0012 返回，不静默忽略。
- 已知开源项目使用固定版本与校验和的 Install Recipe；执行前快照，成功后 Smoke Test，失败恢复。未知来源只生成 Markdown 定制任务，不进入 Driver。
- Multica payload 由冻结 Version 纯函数物化并计算规范 JSON SHA-256。GUI 与 CLI 只提交该产物；Connector 不能读取工作区、聊天、日志或 Keychain 原文。

### 37.2 M34 Multica 官方 CLI Connector

`PublishService` 是 GUI/CLI 共用的发布应用 Core。`buildPublishPackage` 从项目 Version 的物化快照生成递归键排序的规范 JSON hash；Main/CLI Host 再把严格 payload 交给 `MulticaCliPublisher`。Connector 只调用最低 v0.4.32 的官方 JSON 命令，不读取 Multica 配置文件或 Token。

SQLite `publish_mappings` 与 `publish_receipts` 仍是唯一发布操作事实。开发 CLI 通过 `STUDIO_USER_DATA_PATH` 或 `--data-dir` 定位同一数据库；M37 的 App 内 CLI wrapper 负责在无 Node 环境传入精确 userData。`.agent-stack` 只保存冻结便携事实，不保存远端身份或发布状态。

Multica 当前没有 Agent Version 与 create 幂等键。Studio 在远端 instructions 写入 Version/hash 标记；create 前后以真实 list/get 恢复身份，已有映射只更新不重建。远端状态以 `agent get` 标记比对为准，Receipt 只记录已观察到的响应。Native Harness payload 声明 Native Host/Runtime 网络边界并省略 Cordis 版本；Cordis 只出现在历史 Studio Runtime 兼容包。

### 37.3 M35 固定安装方案

`InstallRecipe` 是 Core 中的不可变白名单事实，包含 repository/commit/artifact/license 及各自 SHA-256、目标 Harness 和执行策略。Renderer 只能提交经 schema 验证的来源 locator、recipe ID、Harness、revision 和确认；Main 自行注入当前项目路径。

本地识别只读目录元数据与方案中的固定相对文件，拒绝符号链接；GitHub 识别不发起 clone。安装 Host 只下载注册的文本 URL，校验 Artifact 和 License 后由 Studio Core 更新 Agent Profile。`.agent-stack-local/install-snapshots` 保留 `0600` 快照；Smoke 失败通过项目锁和 revision 条件恢复，不覆盖并发新工作。

未知来源只进入纯函数产生的 Markdown 定制任务。该文档可被 GUI 复制或 CLI `--output` 写入用户指定目的地，但 Studio 不自动交给任何 Agent，也不执行文档中的命令。

### 37.4 M36 Codex CLI Host Driver

第三个 Harness 固定为 Codex CLI `0.148.0-alpha.9`。Driver 使用官方 `codex exec --json` 非交互 JSONL 契约；Run 使用 `--ephemeral`，Chat 将 `thread.started` 的远端线程 ID 以 `0600` 权限保存到 `.agent-stack-local/codex-sessions`，后续消息通过 `codex exec resume` 续接。Studio session UUID 与 Codex thread ID 的映射不会进入 `.agent-stack` 或发布 payload。

Renderer 不能提交 executable、argv、cwd 或 Codex 配置。Driver 固定加入 `--ignore-user-config`、`--ignore-rules` 与 `--skip-git-repo-check`，把 Studio `read-only/workspace` 工具策略分别映射到 Codex `read-only/workspace-write` 沙箱。Prompt 为原生输入；Studio Profile 中的 instructions、Markdown Memory 与 Skill 以显式 Prompt 上下文适配；项目 MCP 配置暂不执行并明确返回降级，避免读取或复制用户级 MCP/规则配置。

### 37.5 M36 固定组件生命周期

`InstallRecipe` 注册表包含 12 个 pinned content-only Skill 方案，并为 Pi/OpenClaw/Codex 保存逐 Harness 支持级别。GUI 与 CLI 的 list/check/install/update/smoke/uninstall/restore 都调用同一个 `CustomizationService`；更新检测比较 App 已审计 hash 与 `.agent-stack` Profile，不访问未固定的 upstream head。

安装、更新和卸载使用项目 revision 写锁；写前快照位于 `.agent-stack-local/install-snapshots`。IPC 恢复输入只有 UUID snapshot ID，Main 从当前项目固定目录解析并拒绝符号链接，Renderer 不能提交路径。内容接线 Smoke 不启动第三方脚本；模型行为验证继续由 Native Agent Core 和 Harness 认证边界承担。

### 37.6 M37 包内 CLI 与 Doctor

`Contents/Resources/bin/studio` 是最终用户入口。它由 Electron Builder 在签名前放入 App，通过 `ELECTRON_RUN_AS_NODE` 使用 App 内置运行时执行 ASAR unpacked CLI，并在未覆盖时传递与 GUI 一致的 Application Support 根目录。包验证与 E2E 在不含 Node.js 的 PATH 下执行该入口。

`StudioDoctorFacts` 是 Host 采集输入，`buildStudioDoctorReport` 是 GUI/CLI 共享的纯 Core，`StudioDoctorReport` 是稳定输出。Main 通过空输入 Zod IPC 采集 App/SQLite/当前项目事实；CLI 采集包内运行时和指定项目事实。两者共享 Harness Probe 和 Multica 版本/认证/Runtime 就绪检查。诊断不读取凭证原文，Harness Probe 不冒充带凭证的模型行为验收。

### 37.7 M37 旧模型迁移边界

项目 Schema 继续读取 `agent-loop/workflow/hybrid/external-harness`，但普通新建 Core 默认为 `external-harness`。GUI 创建 IPC 另用 literal Schema 拒绝旧模式；更新路径只能保留当前历史值或单向迁移到 Native Harness。CLI 产品命令同样拒绝旧模式，`project/workflow` 兼容命令以稳定弃用通知作为显式迁移入口。

Workflow/Experiment 的 Renderer 默认仅渲染历史事实和导出能力；只有当前界面会话中的显式“进入旧版迁移工具”操作才会显示写入控件。该 UI gate 不是权限边界；Main/Core 的 revision、数据 Schema、不可变版本和 CLI 弃用契约仍是真实边界。

最终包内 E2E 使用两个隔离 fixture：普通产品命令必须生成 `external-harness`；历史 Hybrid 验收只能经带 `DEPRECATED_COMMAND` 的兼容命令显式建立。不允许为测试旧 Runtime 而把普通新建路径改回旧模式。

### 37.8 M37 最终包恢复与外部分发边界

备份/恢复 IPC 的生产路径仍由 Main 打开 macOS 目录选择器；Renderer 输入是严格空对象或 opaque selection ID。Packaged E2E 可为 Main 注入两个仅指向临时 Application Support 的选择回调，不向 Preload/Renderer 暴露路径能力。

最终 App 验收会创建备份、改写 Artifact、检查并确认恢复，然后完全退出并重新启动同一 `.app`。`applyPendingRestore` 在任何 Repository 打开前运行；验收分别比对恢复后 Artifact 与 Recovery 中的恢复前 Artifact，并检查 `last-restore.json` 在 GUI 的投影。

Intel CI、Developer ID、Apple 公证和远端凭证是外部事实。无 runner 分配的 Actions job、无证书包和无认证 Doctor 都必须保留原始降级/阻断状态，不得由 fixture 冒充真实成功。
