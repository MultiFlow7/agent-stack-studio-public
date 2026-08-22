# 开发路线图

## 原则

- 先形成可运行的纵向闭环，再扩充组件数量。
- 每个里程碑都必须能够在 macOS 本地安装或运行验证。
- 自动推送到 GitHub 功能分支，测试未通过时不得标记完成。
- 涉及产品范围、数据发布、安全权限或 Multica 认证方式的变化，需要先沟通。

## M0：工程基础

- Electron、React、TypeScript 和打包结构。
- Renderer、Preload、Main、Runtime 的进程边界。
- SQLite 迁移、日志、错误模型和测试基线。
- macOS 开发构建、CI 类型检查和单元测试。

完成条件：应用可以启动，显示本地空状态，创建并读取一条 Agent 记录。

## M1：Agent 与版本

- Agent 列表、创建、详情和设置。
- Stack 草稿与不可变 Agent Version。
- 本地目录导入入口和静态扫描框架。
- 工作区与 Keychain 引用基础。

完成条件：用户能创建或导入 Agent，并生成首个版本快照。

## M2：组件与冲突

- Component Descriptor 和组件目录。
- 能力覆盖、可替换状态和证据。
- 重叠 Owner 决策、依赖预检和 Runtime Plan 编译。
- Cordis 锁定版本、Service 适配和生命周期契约测试。

完成条件：X 覆盖 ABCD、Y 覆盖 CDEFG 的样例可以选择 C、D Owner，并阻止未解决冲突进入运行。

## M3：本地运行

- 独立 Runtime 子进程。
- Agent Loop、Workflow、Hybrid、External Harness 描述。
- Run 状态、事件、取消、超时和产物。
- 冷启动和 Manifest 哈希。

完成条件：一个内置样例能够从 UI 启动、取消和查看完整运行记录。

实现状态：已完成纵向切片。内置 Agent Loop 可从中文 UI 启动，使用独立 Cordis Runtime 子进程，记录 Manifest 哈希、状态、事件和 Artifact；取消、超时、失败与键盘路径均有显式状态和自动化测试。Workflow、Hybrid 与 External Harness 已建立领域描述，但仍在受信执行绑定处主动阻断。

## M4：实验

- 控制变量锁定、变量矩阵和 Drift Check。
- 重复运行、基础指标和结果对比。
- JSON 或 CSV 导出。

完成条件：锁定 A 至 E、调整 F 和 G 的实验能够运行，并识别任何非预期变化。

实现状态：已完成纵向切片。用户可以从不可变 Agent Version 创建 Prompt × 随机种子 × 重复次数矩阵，串行执行独立冷启动 Run，查看成功率、平均耗时和相对基准。Agent Version、Stack/Runtime Plan、Component Descriptor、执行模式、Runtime 环境、权限和数据集均参与 Drift Check；非预期变化会阻断运行。JSON/CSV 导出、取消、失败、空状态和键盘路径已接入中文 UI 并有自动化测试。

## M5：Multica 发布

- Connector Contract。
- Multica 连接、预检、主动发布和 Receipt。
- 本地与远端 Agent ID 映射。

完成条件：已验证 Agent Version 可以发布到测试目标，失败可安全重试，密钥不会进入发布包。

实现状态：已完成本地 Contract Test 纵向切片。已验证的 Agent Version 可以通过中文发布面板主动发布到无网络的本地测试目标；发布包脱敏、字段级预检、幂等 Receipt、失败重试与本地/目标 Agent ID 映射均已持久化并有测试。真实 Multica Transport 仍需要产品负责人确认官方认证、CLI/API 和版本策略，当前在 UI 中明确阻断。

## M6：macOS 分发

- 应用签名、公证、升级策略和数据迁移验证。
- 安装包、备份与恢复说明。
- WCAG 2.2 AA 和键盘路径验收。

完成条件：非开发用户可以在受支持的 Mac 上安装并完成核心闭环。

实现状态：已完成无凭证可验证纵向切片。当前架构的 DMG/ZIP 与 `.app` 可生成、启动和检查；SQLite 旧 schema 升级、新 schema 拒绝、备份逐文件完整性、恢复前自动回滚备份和重启后迁移均有自动化测试。设置页提供中文备份/恢复流程，主要工作流、跳转链接、焦点回还和减少动态效果纳入键盘/WCAG 验收。Developer ID 签名与 Apple 公证仍需外部证书、会员资格与凭据；无凭证构建不表述为已签名或已公证。

## M7：Studio Core 与 CLI

- 厂商无关 Studio Core 与 `.agent-stack` v1 JSON Schema。
- 产品级 `studio` CLI、稳定 JSON/错误码、幂等和 suggested actions。
- 安全本地组件导入、revision 并发、外部修改刷新和不可变项目版本。
- GUI 管理同一项目状态，新安装不自动加载演示组件。

完成条件：本地 fixture 仓库可以经 CLI 和 GUI 双向完成导入、冲突修正、Owner、验证、冻结、revision 冲突和历史引用保护。

## M8：GitHub 发现

- 在不改变 M7 静态安全边界的前提下评估 GitHub 搜索、来源选择与下载交接。
- Coding Agent 仍负责仓库调研、下载、修改和工程命令，Studio 不默认执行第三方代码。

完成条件：GUI 与 CLI 可以主动搜索和检查 GitHub 公开仓库，处理取消、离线、限流和无结果，并生成不执行的结构化下载交接；下载后的目录继续经过 M7 静态检查。

实现状态：已完成公开无认证纵向切片。GitHub REST Adapter、厂商无关 Provider 契约、ETag、rate-limit、取消、稳定 CLI 错误码和中文 GUI 已接入；搜索不发送项目数据、不持久化查询、不自动下载或执行代码。私有仓库、Token 与 GitHub Enterprise 仍未进入产品范围。

## M9：安全与发布边界加固

- Electron Session、WebContents、Renderer CSP 与 IPC 来源统一采用显式默认拒绝策略。
- 对最终 ASAR 执行安全契约检查，为同版本、同架构的 DMG/ZIP 生成并复核 SHA-256 清单。
- 保持 M8 网络范围、未知第三方代码执行边界和无凭证签名/公证表述不变。

完成条件：自动化测试能够证明权限、下载、导航、WebView、远程 IPC 和不安全 CSP 均被拒绝；打包验证读取实际 ASAR，并能发现发布物篡改。

实现状态：已完成默认拒绝与发布完整性纵向切片。Electron 权限、设备、下载、导航、新窗口、WebView、IPC 来源和 Renderer CSP 均有自动化契约；macOS 验证器读取实际 ASAR，并逐文件复核版本/架构绑定的 DMG、ZIP SHA-256。无凭证构建继续明确报告未签名、未公证。

## M10：项目完整性与审计

- 在 Studio Core 中重新计算不可变 Version 快照哈希并校验历史语义。
- CLI 提供稳定的只读 `project audit`，GUI 展示同一报告和最后有效备份恢复提示。
- 保留无效原文件，不把本地 SHA-256 表述成签名或身份认证。

完成条件：本地 fixture 可冻结并通过 CLI/GUI 审计；改写历史快照后审计稳定阻断；存在有效备份时 GUI 明确恢复并保留无效文件。

实现状态：已完成本地项目完整性纵向切片。ProjectStore 每次读取都调用共享 Core 审计，CLI `project audit` 使用不恢复的只读路径并返回稳定错误码；GUI 展示已检查版本数和备份恢复提示。fixture 篡改、无效历史语义、有效备份恢复、外部刷新、CLI/GUI 一致性均有自动化测试。本地 SHA-256 不表述为签名或作者认证。

## M11：发布就绪与真实 Keychain

- 真实 macOS Keychain Adapter、Main 侧受信读取和不回传原文的 IPC。
- Agent 密钥引用管理与 `studio secret` stdin-only 机器契约。
- 正式应用图标、最终包图标验证和打包应用 E2E。
- Apple Silicon 本地与 Intel CI 使用同一发布检查；签名、公证继续按凭据边界执行。

完成条件：GUI 与 CLI 能对同一服务/账户写入、检查和删除本机钥匙串条目，SQLite 和输出中没有密钥；最终 `.app` 使用正式图标并通过真实启动、中文设置页、Renderer 无 Node 和截图检查。

实现状态：已完成无外部凭据纵向切片。Keychain 写入不经 Shell 且不把密钥放入 argv；恢复后的缺失引用有明确状态。包验证检查最终 `.icns`，依赖 Electron 自带 Chromium 的 E2E 实际启动 `.app`。Developer ID、公证和 Intel 真机人工走查仍取决于外部条件，不能由本地 Apple Silicon 结果替代。

## M12：本地可信运行模式

- 为 Agent Loop、Workflow、Hybrid、External Harness 提供版本固定的内置执行 Profile。
- 使用精确 Runtime Adapter 白名单，在创建 Run 记录前阻断未知执行绑定。
- 四种模式共享冷启动、取消、超时、事件、Artifact 和实验矩阵契约。
- 用真实能力视图替换 Agent 详情中的占位页，展示 Provider、Owner、验证证据与阻断项。

完成条件：四种模式都能在不执行导入仓库代码的前提下完成本地 Run；不可变 Manifest 显示对应 Workflow、handoff、Controller 或 Harness 绑定；未注册 Adapter 在排队前被拒绝；能力页覆盖空、加载、失败、就绪与阻断状态。

实现状态：已完成本地可信纵向切片。四种模式使用精确白名单 Adapter 和版本固定 Profile；Main 在创建 Run 前拒绝未知绑定，Runtime 子进程再次核验执行模式、Workflow Version、handoff、Controller 与 Harness。Run、Experiment、取消、超时和 Artifact 沿用同一冷启动契约。Agent 能力页已展示共享 Stack 编译状态，并覆盖空、加载、失败、就绪、阻断和键盘路径。

## M13：本地完整性范围冻结与 Agent 生命周期

- 首次冻结本地完整性矩阵与分发就绪矩阵，逐项关联 GUI、API、自动化与最终包证据。
- Agent 复制、归档、恢复、永久删除和跨 Version/Run/Experiment/Receipt/映射/Keychain 的历史引用保护。
- SQLite v8 归档迁移及失败回滚重试；归档 Agent 统一阻断新的 Version、Run、Experiment 和发布。
- 最终 `.app` 通过键盘可达路径验证复制、归档、无历史删除、有历史阻断与恢复，并生成中文冲突截图。

完成条件：冻结矩阵存在且可计数；Agent 生命周期在 Repository、Service、Zod IPC、Preload、Renderer 和 packaged E2E 中一致；全套质量、CLI、macOS 包、包验证与 E2E 通过。

实现状态：已完成实现与 arm64 本地全套验证，包括打包 GUI 实际启动、`.app` 内 CLI 直接执行并审计临时项目、Agent 历史引用保护和中文失败态截图。分支推送后由 GitHub macOS CI 执行同一检查并保存远端证据。

远端证据：实现提交 `4fab236`、打包 CLI E2E 提交 `4f455b4`；GitHub macOS CI run `32389185634` 在精确 head `4f455b404a1d0ce9608d7974143ab658c2aefd9b` 上通过，包括 Intel macOS 打包、包验证和打包 E2E。

## M14：打包 GUI 与 CLI 项目一致性

- 为最终应用提供经校验的 `--project <path>` 启动路径，直接打开 CLI 创建的 Studio Project。
- 修复项目文件原子替换后 watcher 绑定旧 inode 的问题，覆盖连续 CLI 外部修改。
- 外部刷新移除过期成功反馈，页面始终反映最新 revision 与 Stack 事实。
- 打包 E2E 在同一 fixture 上完成 CLI→GUI、GUI→CLI、CLI→GUI 往返并生成中文截图。

完成条件：最终 `.app` 内 CLI 与最终 Renderer 观察同一 project ID、component ID、format version 和 revision 0→1→2→3；连续外部修改不丢通知，截图无过期成功文案。

实现状态：arm64 本地全套验证已通过，包括 56 个测试文件 / 172 项测试、生产构建、CLI、DMG/ZIP、包验证和打包往返。

远端证据：实现提交 `3764ab5`；GitHub macOS CI run `32391567446` 在精确 head `3764ab5bac18d1c7e856458d31d2a552c4b83fca` 上通过，包括 Intel macOS 打包、包验证与 GUI↔CLI 双向打包 E2E。

## M15：分发兼容契约与无凭证 dry-run

- 建立机器可读 compatibility manifest，对齐唯一应用版本来源、项目格式、SQLite 职责与协议版本。
- 建立有 JSON Schema 和 Zod 验证的纯分发配置，允许注入 channel、download/update URL 和 Apple 强制策略。
- 默认禁用自动更新，不上传产物，不读取或记录凭证值。
- 单一 `release:dry-run` 编排完整本地发布检查，并逐项报告签名、公证、staple、渠道和更新状态。
- 最终 ASAR 携带完全一致的 compatibility/config/schema，包验证拒绝任一字节漂移。

完成条件：默认 local 无凭证 dry-run 完成并明确跳过 Apple 外部步骤；注入 stable/URL 后只改变分发报告；严格 Apple 策略在无票据包上阻断。

实现状态：arm64 默认 local 无凭证 dry-run 已从头完成，包括 59 个测试文件 / 180 项测试、CLI、DMG/ZIP、ASAR compatibility 验证和打包 E2E；报告明确标记三个 Apple 步骤为 skipped、local 渠道和自动更新为 disabled。

远端证据：实现提交 `b0238ad`，Intel runner 稳定性修复提交 `707e41f`；GitHub macOS CI run `32395452269` 在精确 head `707e41fd00939a6454cd055ce2e173d7e2bc864d` 上通过，包括 Intel macOS 打包、包验证、GUI↔CLI 双向打包 E2E 和无凭证 release dry-run。

## M16：本地数据诊断与卸载边界

- 在设置页显示 Main 解析的 Application Support、SQLite、Workspace、Artifact、Recovery 和 Log 路径。
- 通过严格枚举 IPC 在 Finder 中显示路径，不向 Renderer 开放任意文件系统访问。
- 在 GUI 和分发文档中固化备份包含/排除、标准卸载、彻底清理、外部项目与 Keychain 保留边界。

完成条件：路径投影、枚举白名单、键盘 Finder 操作和打包中文界面都有自动证据；不实施自动删除。

实现状态：arm64 本地完整 dry-run 已通过 60 个测试文件 / 185 项测试、构建、CLI、DMG/ZIP、包验证与打包 E2E；打包设置页输出 `DATA_LOCATION_BOUNDARIES VERIFIED` 并保存数据位置与卸载中文截图。

远端证据：实现提交 `b2e418b`；GitHub macOS CI run `32397966040` 在精确 head `b2e418b291e54d507904c5e0b16322e00be22665` 上通过，包括 Intel macOS 打包、包验证、数据位置中文打包 E2E 和无凭证 release dry-run。

## M17：持久化界面偏好

- 复用 v7 `app_preferences` 保存窗口 normal bounds/最大化、侧栏收起与最后一级页面。
- Main 丢弃离屏坐标并限制恢复尺寸；Renderer 只能通过严格枚举 IPC 保存两个界面字段。
- 侧栏收起后保留键盘与可访问名称，偏好失败不阻断应用。

完成条件：新安装默认、存储重开、损坏回退、离屏坐标、键盘收起/展开和打包 Renderer 重载恢复均有自动证据。

实现状态：arm64 本地完整 dry-run 已通过 62 个测试文件 / 192 项测试、构建、CLI、DMG/ZIP、包验证与打包 E2E；最终 `.app` 在 Renderer 重载后恢复设置页和收起侧栏，输出 `PERSISTED_UI_PREFERENCES VERIFIED` 并保存中文截图。

远端证据：实现提交 `c6a9377`；GitHub macOS CI run `32400884089` 在精确 head `c6a93771dc7f8c28e996a0a593a7c9b5e586cb25` 上通过，包括 Intel macOS 打包、包验证、持久化中文打包 E2E 和无凭证 release dry-run。

## M18：无密钥可移植项目包

- 新增带严格 Schema、生成器版本、排除清单和包级 SHA-256 的 Agent Stack Package v1。
- Studio Core 在原子写入前拒绝本机绝对路径、`file:` URL、URL 凭据和查询参数，不改写不可变 Version。
- GUI 与 CLI 共用 Core；Main 原生选择目标，Renderer 只收受校验回执。

完成条件：单元、Core/CLI/GUI 一致性、IPC 拒绝原始路径、打包 GUI/CLI 同 revision 导出、哈希复算、敏感扫描、包文件和中文截图全部通过。

实现状态：arm64 本地完整 dry-run 已通过 64 个测试文件 / 200 项测试、构建、CLI、DMG/ZIP、包验证与打包 E2E；输出 `SECRET_FREE_PORTABLE_PACKAGE VERIFIED`、`artifacts/packaged-agent-stack-package.json` 和 `artifacts/packaged-app-e2e-portable-export.png`。

远程证据：实现提交 `8daa418`；GitHub macOS CI run `32404134587` 在精确 head `8daa418713bf9ae73e13228755201be2083a6a58` 上通过，包括 Intel x64 打包、包验证、GUI/CLI 同 revision 导出、敏感扫描和无凭证 release dry-run。

## M19：真实 Agent 状态投影

- 以共享只读契约聚合 Agent 草稿/版本、Stack、最近 Run、最近 Experiment 和最近 Publish Receipt，不新增数据库列或复制领域事实。
- Agent 列表与概览使用同一投影；Run 等事实变化后，返回概览或列表会重新读取当前状态。
- 新增两个严格 Zod IPC，Renderer 不能指定数据库、路径或敏感字段；既有 `agents.list` 保持兼容。
- 最终 `.app` 在真实 Hybrid Version+Run 后同时断言详情和列表中的版本、Stack、Run 与发布状态，并保存中文截图。

完成条件：Service、IPC、Preload、Renderer、空/有数据/失败与键盘路径测试通过；arm64 包真实启动后输出 `AGENT_STATUS_PROJECTION VERIFIED`；完整本地 dry-run 与 Intel CI 通过。

实现状态：本地 arm64 与 GitHub Intel 验证均已通过 66 个测试文件 / 205 项测试、生产构建、CLI、DMG/ZIP、包验证和 packaged E2E；列表与概览显示同一真实状态，中文截图已人工复核。

远程证据：实现提交 `fce3240`；GitHub macOS CI run `32407044527` 在精确 head `fce32409924cedc5c88e58fd92b9460682a250b3` 上通过，包括 Intel x64 项目检查、应用打包、包验证、Agent 状态 packaged E2E 和无凭证 release dry-run。

## M20：组件目录投影与详情

- 以共享只读契约组合 Component Descriptor、当前 Agent Stack 草稿和不可变 Agent Version 引用，不新增数据库迁移。
- 全局组件目录支持名称/Contract ID/能力搜索以及兼容、来源筛选，真实显示使用方、受影响版本与最近验证记录。
- 组件详情覆盖 Manifest、来源/许可/平台、提供与依赖、替换等级、Adapter/Fork、配置 Schema、Keychain 敏感边界、测试证据和受影响 Agent Version。
- declared 证据不生成虚构验证时间；详情和目录都不改变未知第三方代码执行权限。

完成条件：目录加载/空/筛选无结果/失败重试、详情加载/成功/失败重试与键盘路径都有测试；严格 IPC 拒绝任意路径；最终 `.app` 在真实 Harness 草稿+Version 后保存中文详情截图并输出 `COMPONENT_CATALOG_DETAIL VERIFIED`。

实现状态：本地 arm64 与 GitHub Intel 验证均已通过 69 个测试文件 / 212 项测试、生产构建、CLI、DMG/ZIP、包验证和 packaged E2E；组件目录与详情中文截图已人工复核。

远程证据：实现提交 `ed87a5c`；GitHub macOS CI run `32409800701` 在精确 head `ed87a5cf8ad42a667af40484c120c6d641812eb9` 上通过，包括 Intel x64 项目检查、应用打包、包验证、组件详情 packaged E2E 和无凭证 release dry-run。

## M21：版本化 Workflow DAG 与项目格式 v2

- 把 Workflow 草稿、结构化节点/边和不可变 Workflow Version 纳入 `.agent-stack` v2；Agent Stack Package 同步升级到 v2。
- 保存时拒绝直接 DAG 循环、悬空引用和跨 Workflow Version 的直接/间接循环；Component 历史引用继续受保护。
- ProjectStore 支持 v0/v1 升级、迁移失败恢复和新版拒绝降级；历史 v1 项目 Version 哈希不被重算。
- Core、CLI、Main Service、严格 IPC、Preload 和 Studio 项目 GUI 完成同一纵向写路径、只读图示、冻结、取消、失败、冲突与外部刷新。
- packaged E2E 用包内 CLI 创建/冻结 Workflow，GUI 显示并拒绝回边，再完成 GUI→CLI 与 CLI→GUI 往返及 v2 包逐字一致。

完成条件：直接/间接循环、幂等冻结、Component 历史保护和项目格式迁移全部自动化通过；最终 `.app` 输出 `VERSIONED_WORKFLOW_DAG VERIFIED` 并保存中文 DAG/循环失败截图；全套本地与 Intel CI 通过。

实现状态：本地 arm64 与 GitHub Intel 验证均已通过 70 个测试文件 / 220 项测试、生产构建、CLI、DMG/ZIP、包验证和 packaged E2E。最终 `.app` 输出 `VERSIONED_WORKFLOW_DAG VERIFIED`；项目/包格式均为 v2，最终 revision 10 的 GUI/CLI 导出逐字一致。中文 DAG 与循环失败截图已人工复核，错误不泄漏 Electron IPC 前缀。

远程证据：实现提交 `cee8b7f`；GitHub macOS CI run `32414316351` 在精确 head `cee8b7f433e921efeb33dff50e8a46d245b48085` 上通过，包括 Intel x64 项目检查、应用打包、包验证、Workflow packaged E2E 和无凭证 release dry-run。

## M22：Adapter/Fork 处置任务与 Component 生命周期

- 以共享 Schema 从 Descriptor 派生 Adapter/Fork 工作产物、契约测试和最小运行验证任务；区分已有证据与待完成。
- Agent Runtime Plan 与 Studio 项目验证返回同一任务链；CLI suggestedActions 只投影待完成步骤，Renderer 不复制规则。
- 任务不持久化、不读取引用目标、不执行代码，也不改变精确 Runtime Adapter 白名单；最小运行验证前 Stack 保持阻断。
- Studio 项目 GUI/CLI 完成 Component 加入、移出、归档、取消删除与确认删除；历史引用保护继续自动化回归。
- packaged E2E 同时验证 Agent 能力页任务、项目 CLI→GUI 任务一致性和 Component revision 3→8 生命周期，再继续回归 Workflow revision 8→15 与 v2 包一致。

完成条件：共享 Core/CLI/GUI 与删除保护测试通过；最终 `.app` 输出 `COMPONENT_REMEDIATION_TASKS VERIFIED` 和 `PROJECT_COMPONENT_LIFECYCLE VERIFIED`，保存任务、删除确认和删除成功中文截图；全套本地与 Intel CI 通过。

实现状态：本地 arm64 与 GitHub Intel 验证均已通过 71 个测试文件 / 227 项测试、生产构建、CLI、DMG/ZIP、包验证和扩展 packaged E2E。报告为 5 verified、3 skipped、2 disabled、0 blocked；四张新增中文截图已人工复核。

远程证据：实现提交 `d8d0d25`；GitHub macOS CI run `32417526969` 在精确 head `d8d0d25555ce0fe5314d4d1a8c9484f1a6533dcd` 上通过，包括 Intel x64 项目检查、应用打包、包验证、任务/Component 生命周期 packaged E2E 和无凭证 release dry-run。

## M23：Run 历史可观测性与真实超时证据

- 以共享严格 Schema 和 Main 只读服务组合 Run、Manifest 与 Experiment 事实，显示失败原因、变量、总耗时和 Drift。
- Drift 只从不可变 Run Manifest 对照锁定实验基准重算；独立 Run 明确为不适用，不读取当前可变 Stack。
- Preload 与两个 Run IPC 输出统一升级，严格拒绝路径、数据库或强制参数；不增加数据库迁移、项目格式或 Runtime 协议字段。
- Run GUI 增加耗时列、500ms/1s 本地超时选项和只读历史区域；终态无编辑入口。
- packaged E2E 在成功 Hybrid Run 后自然触发 500ms 超时，验证两种终态并存、Runtime 清理、中文失败文案和历史截图。

完成条件：Service/IPC/Renderer 测试覆盖独立、实验 clean/blocked Drift 与超时失败；最终 `.app` 输出 `RUN_HISTORY_OBSERVABILITY VERIFIED` 并保存中文截图；全套本地与 Intel CI 通过。

实现状态：本地 arm64 已通过 73 个测试文件 / 233 项测试、生产构建、CLI、DMG/ZIP、包验证和扩展 packaged E2E；`artifacts/packaged-app-e2e-run-timeout-history.png` 已人工复核。无数据库、项目格式或 Runtime 协议迁移。

远程证据：实现提交 `10ecb27`；GitHub macOS CI run `32420946138` 在精确 head `10ecb277f3b745e76633f87ec03d02b807ced2f8` 上通过，包括 Intel x64 项目检查、应用打包、包验证、Run 历史真实超时 packaged E2E 和无凭证 release dry-run。

## M24：实验矩阵可观测性与部分结果证据

- 在既有 Experiment 详情上派生计划/终态、成功/需关注、终态成功率和成功平均耗时，不新增持久化事实。
- 持续展示 Prompt 变量、种子、重复、超时、评价器和时间范围，使筛选后的矩阵仍有完整复现语境。
- 提供全部、进行中、成功、需关注筛选以及 Prompt/seed/Run/失败原因搜索；筛选只读且可清除。
- 明确区分失败、取消、Drift 阻断和部分完成；基础对比对没有成功耗时的组合显示无可比值。
- packaged E2E 启动真实四单元实验，在首个单元成功后整体取消，验证 1 成功 + 3 取消、筛选和相对基线并保存两张中文截图。

完成条件：Renderer 单元测试覆盖部分成功、取消、失败、Drift 阻断、相对基线和筛选空状态；最终 `.app` 输出 `EXPERIMENT_MATRIX_OBSERVABILITY VERIFIED`；全套本地与 Intel CI 通过。

实现状态：本地 arm64 已通过 73 个测试文件 / 234 项测试、生产构建、CLI、DMG/ZIP、包验证、扩展 packaged E2E 和完整无凭证 dry-run；报告为 5 verified、3 skipped、2 disabled、0 blocked。`artifacts/packaged-app-e2e-experiment-partial-matrix.png` 与 `artifacts/packaged-app-e2e-experiment-relative-baseline.png` 已人工复核。SQLite、项目/包格式、Runtime 与 CLI 项目协议保持不变。

远程证据：实现提交 `d2013c2`；GitHub macOS CI run `32423257044` 在精确 head `d2013c2d294a534b63784d2e4d40a76681263410` 上通过，包括 Intel x64 项目检查、应用打包、包验证、Experiment 部分取消 packaged E2E 和无凭证 release dry-run。

## M25：来源发现完整状态与恢复动作

- GitHub Adapter 新增独立 `DISCOVERY_TIMEOUT`，与用户取消和离线网络失败分开；限流、查询错误和 Provider 错误继续保持稳定代码且不自动重试。
- Preload 对搜索、检查、交接、取消、复制和打开 URL 统一净化 Electron IPC 错误前缀，不放宽现有 Zod 与 GitHub URL 白名单。
- Renderer 对本地校验、离线、超时、限流和 Provider 故障显示不同的标题、解释和恢复动作；本地无效输入零网络并把键盘焦点返回搜索框。
- 自动化覆盖空闲、加载/取消、成功、有/无结果及四类远端失败；packaged E2E 只使用本地校验生成稳定失败证据，不依赖真实 GitHub 服务。
- 两张中文截图证明首次公开元数据边界、键盘焦点、本地失败原因及可恢复操作；没有下载、持久化或执行第三方代码。

完成条件：Adapter、Service、Renderer 与 packaged E2E 覆盖所有冻结状态；最终 `.app` 输出 `SOURCE_DISCOVERY_STATE_COVERAGE VERIFIED`；全套本地与 Intel CI 通过。

实现状态：本地 arm64 已通过 73 个测试文件 / 243 项测试、生产构建、CLI、DMG/ZIP、包验证、扩展 packaged E2E 和完整无凭证 dry-run；报告为 5 verified、3 skipped、2 disabled、0 blocked。`artifacts/packaged-app-e2e-source-discovery-idle.png` 与 `artifacts/packaged-app-e2e-source-discovery-validation-error.png` 已人工复核。没有项目、数据库、Runtime 或 CLI 项目协议迁移。

远程证据：实现提交 `1777dcd`，跨架构 Experiment 取消证据稳定化提交 `18e7ce1`、`bbfe384`；GitHub macOS CI run `32426869067` 在精确 head `bbfe3842e859cd8de79f1ca935fb1114b7f73b37` 上通过，包括 Intel x64 项目检查、应用打包、包验证、Source 状态 packaged E2E 和无凭证 release dry-run。

CI 审计：run `32425437853`、`32426127696` 暴露并复现了取消按钮仍禁用时的跨架构 E2E 竞态，修复后由上述 run 验证；证据提交 `3d150fc` 的 run `32427694409` 和 `a90d8a5` 的 run `32428402546` 多次未分配 runner 且没有执行 step。用户确认可使用公开仓库后，为避免泄露早期提交作者邮箱，保留私有历史而不改写，以隐私门禁审计后的单提交快照建立公开 CI 镜像。私有 `f525c4c` 与公开 `f2b6e62` 共享 tree `055a13a70b08eb088ae2d63558514bf7b7a8b7c8`；公开 Intel CI run `32438973147` 通过完整项目检查、打包、包验证、packaged E2E 和无凭证 dry-run，M25 证据门禁由此关闭。

## M26：工作区命令中心与统一状态词汇

- Main 以只读服务组合 Studio Project、Agent 状态、Component 目录、Run 和 Experiment，不复制事实或引入迁移。
- 顶栏显示真实项目/revision/验证状态与最近 Run，项目外部变化和活动 Run 触发更快刷新；摘要故障不阻断当前页面。
- `⌘K` 命令面板只搜索本机元数据与固定白名单操作，支持加载、无结果、失败、焦点约束、上下选择、Enter 直达和 Escape 关闭。
- Component、Run 与 Experiment 页面接收严格 UUID 目的地后打开完整详情；Agent 继续使用既有详情服务。
- Agent、Stack、Run、Experiment、Publish、工作区与活动状态集中到同一 Renderer 词汇层，图标和文字始终伴随颜色。
- packaged E2E 必须在真实 Hybrid Run 后验证工作区与 Run 状态、用 `⌘K` 找到并打开本机 Agent，并保存中文命令中心截图。

完成条件：Core/Service/IPC/Preload/Renderer 与直达页面测试通过；最终 `.app` 输出 `WORKSPACE_COMMAND_CENTER VERIFIED`；隐私门禁、全套本地验证和公开 Intel CI 均成功。

实现状态：78 个测试文件 / 259 项测试、生产构建、CLI、arm64/x64 DMG/ZIP、包验证和 packaged E2E 已在本机与公开 Intel CI 通过；最终项目 revision 15、GUI/CLI v2 包逐字一致，`artifacts/packaged-app-e2e-command-center.png` 已人工复核。

远程证据：私有实现提交 `ef4961d` 与公开实现提交 `d1d374e` 共享 tree `dc5ad74015c9da7f27912ff4bd5a9b2d24c79396`；公开 GitHub macOS CI run `32442138733` 成功，完成 Intel x64 项目检查、应用打包、包验证、工作区命令中心 packaged E2E 与无凭证 release dry-run。

## M27：本地验收、可访问树与断路门禁

- 新增版本化验收分类，逐项记录 7 个一级入口、6 个输入提示和 2 组最终包控制的用途。
- `npm run check` 自动拒绝 production TODO/FIXME/HACK、占位文案、死操作、未分类 harness 和 GUI/命令中心导航断裂。
- 最终 `.app` 逐个聚焦并打开全部一级入口，确认页面标题与 `aria-current=page`。
- Chromium Accessibility Tree 必须暴露 main/navigation landmarks、全局搜索和创建操作，所有可见按钮名称非空。
- 保留现有对比度、焦点、减少动态效果和 Dialog 键盘契约；不增加业务协议或测试成功旁路。

完成条件：源码门禁、verifier tests、最终 arm64/x64 包与 packaged E2E 通过，输出 `LOCAL_ACCEPTANCE_AUDIT VERIFIED`、`NAVIGATION_REACHABILITY VERIFIED (7)` 和 `PACKAGED_ACCESSIBILITY_TREE VERIFIED`。

本地实现状态：120 个 production 源文件、7 个入口、6 个输入提示和 2 组 packaged harness 已分类，未处置项 0；最终 arm64 `.app` 显示 21 个可见按钮、0 个无名称按钮，7 个入口全部实际打开。

远程证据：私有实现提交 `a52437c` 与公开实现提交 `ebf6bfd` 共享 tree `191c580716fe4901bd26798e4483ed7f8e29f940`；公开 GitHub macOS CI run `32444148841` 成功，完成 Intel x64 项目检查、应用打包、包验证、全入口/AX tree packaged E2E 与无凭证 release dry-run。

## M28：最终证据台账与报告

- 从两张冻结矩阵直接生成 136 条机器需求记录，拒绝删行、改号、非法状态或本地未完成项。
- 8 条跨领域用户旅程逐条绑定空/加载/成功/失败/取消/冲突/外部刷新/键盘证据。
- 23 张最终包中文截图绑定旅程、状态和 producer；它们只留在 Git-ignored 本地验收目录。
- 公开仓库隐私门禁默认拒绝不透明二进制，只允许已复核应用图标。
- 最终报告必须包含需求 ID、私有/公开提交、验证命令、包路径、截图路径和公开 CI。

完成条件：`verify:evidence-ledger` 与 strict `verify:final-report` 通过；本地全套包验收与公开 Intel CI 成功；最终报告可从本地产物直接生成。

实现状态：80 个测试文件 / 266 项测试全部通过；本地 arm64 `.app`、包内 CLI、DMG/ZIP、包验证、23 张中文截图和无凭证 dry-run 通过，报告 5 verified、3 skipped、2 disabled、0 blocked。`verify:evidence-ledger` 验证 136 条需求、8 条旅程和 23 个截图 producer。

远程证据：私有实现提交 `2c9fdd9` 与公开实现提交 `7748351` 共享 tree `e3846498ce6d4621491f39ac1988e28f2a7cff96`；公开 GitHub macOS CI run `32446386099` 成功，完成 Intel x64 项目检查、应用打包、包验证、packaged E2E 和无凭证 release dry-run。

## M29：稳定性、并发与敏感信息审计

- 对空值、重复请求、并发、权限、超时、异常和敏感信息进行跨 Core/Main/Preload/Renderer/Runtime/CLI 审计。
- 同一只读请求合并，写操作使只读请求失效；发布、维护、Keychain 与发现操作使用明确单航班或串行边界。
- 项目迁移和恢复进入进程写锁，仅回收死亡进程的过期锁；重复 Run 取消、Runtime 停止和 Renderer 晚到响应保持幂等。
- Keychain、发布 Adapter、GitHub 与 Runtime 子进程都有有界超时；异常不再保存远端或子进程原始错误。
- 日志、工作区、Artifact、备份、恢复和导出使用私有权限；Runtime stdout/stderr 只记录字节数，不记录正文。
- Git remote、Descriptor、公开来源 URL、CLI/IPC/Runtime 错误和结构化日志统一拒绝或净化凭证与敏感查询参数。

完成条件：83 个测试文件 / 284 项测试、`npm run check`、CLI/macOS 打包、包验证、packaged E2E、公开快照隐私门禁和公开 Intel CI 全部通过；最终 `.app` 与包内 CLI 实际启动。本切片不增加数据库或项目格式迁移，不改变领域、IPC 或 Runtime 协议。

## M30：Agent-first 项目一体化

- 将 Stack、Owner、兼容性、Workflow 和 Version 冻结收敛到 Agent 主流程，项目管理降级为全局上下文与次级设置。
- 以 `.agent-stack` 作为六类便携事实的唯一来源，SQLite v9 只保留稳定 Agent/项目/不可变 Version 引用和本机运行事实。
- 为旧 SQLite Agent/Component 和历史项目增加幂等、可恢复、冲突拒绝的启动迁移。
- 新增可解释兼容性评估，由 Core 给出证据、阻断原因、建议动作和安全验证边界；Descriptor 编辑不再等于人工确认。

完成条件：导入后 Agent 立即可选、GUI↔CLI 一致、revision/外部修改/迁移恢复/未知代码不执行全部有自动证据；六个一级入口、最终 arm64 `.app`、包内 CLI、中文状态截图和公开 CI 通过。

本地实现状态：85 个测试文件 / 286 项测试、`npm run check`、CLI/macOS 打包、包验证、真实 arm64 GUI 与包内 CLI 双向一致、revision 冲突、中文截图和无凭证 dry-run 均通过；证据台账覆盖 150 条需求、8 条旅程和 23 张截图。
