# 正式分发架构就绪矩阵

## 判定口径

- 基线与本地完整性矩阵一致：`bceec476a6205a047efab7523ec75015ad70a905`。
- 本矩阵区分“无凭证即可完成的架构/验证”和“必须依赖外部证书、账号、凭证或真实服务的执行步骤”。
- 正式分发允许的未来改动仅限凭证、Apple 公证、发布元数据、下载/更新地址、渠道配置以及 Apple 平台强制调整；不得借分发重写领域、项目 Schema、数据库职责、IPC、Runtime 协议或 GUI/CLI 业务路径。

| 需求 ID | 来源 | 分发场景 | 当前状态 | 本地/自动化证据 | 凭证边界 | 最终处置 |
| --- | --- | --- | --- | --- | --- | --- |
| RR-001 | 用户分发要求 1；ADR 0003 | GUI、CLI 和项目格式从明确的共享版本来源取值 | COMPLETE | `package.json#version` 是应用/CLI/Agent Stack Package 生成器唯一来源；compatibility manifest 绑定项目 v2、导出包 v2、DB schema、Bundle ID 与 macOS 下限 | 无 | `release-compatibility.test.ts`；最终 ASAR 验证 |
| RR-002 | 分发文档 1/2 | arm64 `.app`、DMG、ZIP 可构建 | COMPLETE | `package:mac`；架构/命名测试 | 无 | 保持 |
| RR-003 | 用户分发要求 2 | arm64 包可安装、启动并完成核心流程 | COMPLETE | packaged E2E 实际启动 `.app` 并完成 Hybrid 创建/Stack/冻结/Run | 无 | 增加 DMG 拖装人工证据，但不阻断架构就绪 |
| RR-004 | 分发文档 8；ADR 0007 | Intel x64 在 GitHub macOS Intel runner 执行同一包检查 | COMPLETE | `.github/workflows/ci.yml` 使用 `macos-15-intel` | GitHub 托管 runner | 每里程碑确认 CI 成功 |
| RR-005 | 分发文档 8 | 不把单架构结果表述为 Universal Binary 或另一架构真机验证 | COMPLETE | 文档与包名显式架构 | Intel 真机人工走查外部 | 保持 |
| RR-006 | 用户分发要求 3；ADR 0003 | CLI 随应用打包、可被 GUI 发现、不静默修改 PATH | COMPLETE | Studio 项目页路径；包验证检查 unpacked CLI | 无 | 保持 |
| RR-007 | 用户停止条件 13 | 实际从最终 `.app` 路径执行 CLI 并与 GUI 读取同一 fixture | COMPLETE | packaged E2E 直接执行 `.app` 内 CLI；GUI 通过 `--project` 打开同一 fixture；CLI 导入、GUI 加入 Stack、CLI 复核/移出、GUI 再刷新全部断言 | 无 | M14 关闭 |
| RR-008 | 用户分发要求 4 | Developer ID 身份/证书通过环境或钥匙串注入，不写仓库 | COMPLETE | electron-builder 标准注入；文档列出变量 | 真实 Developer ID 外部 | 保持 |
| RR-009 | 用户分发要求 4；分发文档 3 | 公证凭据/API key/Apple ID/keychain profile 可注入 | COMPLETE | electron-builder 配置与文档 | Apple 凭证外部 | 保持 |
| RR-010 | 用户分发要求 4 | staple 行为可配置且验证器能显式要求票据 | COMPLETE | release config 可强制 staple 且要求公证；验证器运行 `xcrun stapler validate`；dry-run 单独报告 | 真实票据仍外部 | config/report 测试；包验证 |
| RR-011 | 用户分发要求 4 | 发布渠道可注入，不进入领域或业务协议 | COMPLETE | `local|alpha|beta|stable` 可由 config 或 `STUDIO_RELEASE_CHANNEL` 注入；仅进入分发报告 | 真实上传外部 | `release-config.test.mjs`；注入 dry-run |
| RR-012 | 用户分发要求 4 | 下载地址可注入，不进入领域或业务协议 | COMPLETE | HTTPS `downloadBaseUrl` 可由 config/环境注入；非 local 缺失时报告阻断 | 真实托管外部 | config/report 测试 |
| RR-013 | 用户分发要求 4 | 更新地址可注入，但当前不启用自动更新 | COMPLETE | HTTPS `updateFeedUrl` 可注入；Schema 强制 `automaticUpdates: false`；dry-run 标为 disabled | 真实更新服务外部 | schema/Zod/注入 dry-run 测试 |
| RR-014 | 用户分发要求 5 | 无凭证模式可做完整 release dry-run 并逐项报告跳过原因 | COMPLETE | `npm run release:dry-run` 已完整运行 check/CLI/macOS 包/包验证/E2E；`release-dry-run-0.8.0-arm64.json` 中 5 verified、3 skipped、2 disabled、0 blocked | 无 | 单元测试；默认 local 无凭证完整运行 |
| RR-015 | ADR 0005 | 最终 ASAR 验证 Renderer CSP 与 Main 安全标记 | COMPLETE | `verify-security-boundaries.mjs` | 无 | 保持 |
| RR-016 | ADR 0005 | DMG/ZIP 有版本+架构绑定的稳定 SHA-256 清单并拒绝篡改 | COMPLETE | release-integrity 脚本/测试/包验证 | 无 | 保持 |
| RR-017 | 分发文档 2 | Bundle ID、最低 macOS、图标、可执行文件、ASAR、CLI 和项目包 Schema 均从最终包验证 | COMPLETE | `verify-macos-package.mjs` + tests；项目/Agent Stack Package v1 历史与 v2 当前 Schema 存在性检查 | 无 | 保持 |
| RR-018 | ADR 0007 | 正式 `.icns` 写入最终 Info.plist/Resources | COMPLETE | 包验证 | 无 | 保持 |
| RR-019 | 用户分发要求 6；技术架构 6/11 | Application Support、Workspace、Artifacts、Recovery 路径稳定 | COMPLETE | Main 从唯一 userData 根派生 6 个位置；共享 schema、service/IPC/UI 测试和 packaged E2E | 无 | M16 路径投影与枚举 Finder 契约 |
| RR-020 | 用户分发要求 6；ADR 0007 | Keychain 服务名/账户引用跨升级稳定，原文不迁移 | COMPLETE | 固定默认 service；Keychain/backup tests | 用户本机登录钥匙串 | 保持 |
| RR-021 | 用户分发要求 6；分发文档 4 | SQLite 新装、历史升级、失败回滚、新版拒绝边界稳定 | COMPLETE | v1→v8、新装、幂等、冲突失败回滚/重试、新版拒绝全部自动化通过 | 无 | M13 完成并持续回归 |
| RR-022 | 用户分发要求 6 | 备份、恢复、回滚与跨机器 Keychain 缺失边界稳定 | COMPLETE | maintenance + secret tests；设置 UI | 无 | 保持；补 packaged 恢复证据 |
| RR-023 | 用户分发要求 6 | 卸载边界说明哪些数据保留、如何彻底移除、如何先备份 | COMPLETE | 分发文档与设置 UI 说明先备份、标准卸载保留、Application Support 与 Keychain 手动清理、外部项目保留 | 无 | M16 关闭；无自动删除 IPC |
| RR-024 | 用户分发要求 7 | 正式分发不改变领域模型、项目/导出包 Schema、DB 职责、IPC、Runtime、GUI/CLI 路径 | COMPLETE | compatibility manifest 机器固化 Agent Stack Package v2、项目 v2、领域/IPC/Runtime/CLI 契约与 DB 职责；M22–M24 派生视图不新增持久化，M25 只细化 Adapter 错误和现有 Preload/UI 边界 | 无 | 共享契约测试；ASAR 验证；packaged 同 revision 逐字一致 |
| RR-025 | 用户分发要求 8 | 未来分发改动仅限凭证/公证/元数据/地址/渠道/Apple 强制项 | COMPLETE | manifest 只列出允许变更字段；release config schema 不接受业务字段或凭证 | 外部发布条件 | strict schema/Zod/回归测试；ADR 0007 补充 |
| RR-026 | 分发文档 3 | 有凭证时严格要求 Developer ID 签名 | EXTERNAL-BLOCKED | `STUDIO_REQUIRE_SIGNED=1` 验证路径已实现 | Developer ID 证书/会员 | 获得证书后执行，不改业务代码 |
| RR-027 | 分发文档 3 | 有凭证时 Apple 公证并 staple | EXTERNAL-BLOCKED | `STUDIO_REQUIRE_NOTARIZED=1` 验证路径已实现 | Apple 公证凭证 | 获得凭证后执行，不改业务代码 |
| RR-028 | 分发文档 8 | Intel 真机人工安装与核心流程走查 | EXTERNAL-BLOCKED | Intel CI 自动化可用 | Intel 真机/人工环境 | 外部条件到位后执行 |
| RR-029 | 用户验证 5 | 每个里程碑全套 format/lint/type/test/build/CLI/package/verify/E2E | COMPLETE | M13–M25 本地与 Intel CI 通过；M25 为 73 files / 243 tests、build、CLI、DMG/ZIP、包验证、确定性 Source packaged E2E 和完整无凭证 dry-run；报告 5 verified、3 skipped、2 disabled、0 blocked；run `32426869067` | 无 | 持续对每个里程碑执行同一验证 |
| RR-030 | 用户实施要求 | 每个里程碑提交、推送并确认 GitHub CI | COMPLETE | M13–M25 实现 CI 均成功；M25 私有 head `f525c4c` 与公开 snapshot `f2b6e62` 共享 tree `055a13a70b08eb088ae2d63558514bf7b7a8b7c8`，公开 run `32438973147` 成功 | 公开 GitHub hosted runner | 每切片保留相同 tree 证据并等待 CI |
| RR-031 | 用户停止条件 14 | 最终报告关联需求 ID、提交、测试、包路径、截图、CI | MISSING | 两张矩阵建立证据骨架 | 无 | 最终里程碑生成机器可核验报告 |
| RR-032 | M21；用户分发要求 7 | 正式分发前 Workflow 已进入稳定项目/包协议且历史项目无需领域重写 | COMPLETE | project/package v2、v0/v1 迁移、v3 前向拒绝、历史 v1 快照哈希保留、Workflow Core/CLI/IPC/GUI 与最终 arm64 包全部通过；最终 v2 包含 1 Workflow/1 Version 且无本机路径或敏感值 | 无 | `VERSIONED_WORKFLOW_DAG VERIFIED`；release compatibility/ASAR/package/E2E 证据 |
| RR-033 | M22；用户分发要求 7 | Adapter/Fork 处置链和 Component 生命周期无需为正式分发改写项目/DB/Runtime | COMPLETE | 任务由 Descriptor 确定派生，不进入 SQLite、项目/包、Version 或 Runtime Plan；GUI/CLI 共用 Core，最终包 revision 15 逐字一致 | 无 | remediation/Core/CLI/UI tests；`COMPONENT_REMEDIATION_TASKS VERIFIED`；`PROJECT_COMPONENT_LIFECYCLE VERIFIED` |
| RR-034 | M23；用户分发要求 7 | Run 历史失败/变量/耗时/Drift 无需为正式分发改写数据库、项目或 Runtime | COMPLETE | 只读服务从既有 Run Manifest、时间戳与 Experiment 定义派生；两个严格 IPC 输出升级，SQLite v8、项目/包 v2 与 Runtime 协议保持不变 | 无 | Service/IPC/Renderer tests；真实 500ms packaged 超时；`RUN_HISTORY_OBSERVABILITY VERIFIED` |
| RR-035 | M24；用户分发要求 7 | Experiment 部分结果、筛选、指标与相对基线无需为正式分发改写持久化或业务协议 | COMPLETE | Renderer 从既有严格 `ExperimentDetail` 的 definition/cells/comparison/drift 只读派生；无新 IPC、SQLite、项目/包、Runtime 或 CLI 项目字段 | 无 | Renderer tests；真实 1 成功 + 3 取消 packaged E2E；`EXPERIMENT_MATRIX_OBSERVABILITY VERIFIED` |
| RR-036 | M25；用户分发要求 7 | 来源发现错误/恢复状态无需为正式分发引入凭证、持久化或新业务协议 | COMPLETE | 固定 GitHub Adapter 细分 timeout/network；既有 6 个白名单 IPC 统一净化错误；Renderer 临时状态零持久化，项目/DB/Runtime/CLI 项目协议不变 | 真实 GitHub 可用性不作为打包成功条件 | Provider/Renderer tests；确定性本地校验 packaged E2E；`SOURCE_DISCOVERY_STATE_COVERAGE VERIFIED` |
| RR-037 | 用户公开仓库要求 | 公开代码和 CI 不泄露私有历史、凭证或个人信息 | COMPLETE | 私有已共享历史不改写且不镜像；公开仓库仅含 noreply 作者的审计快照；`verify:public-snapshot` 检查 251 个文件 | 无凭证入库 | 3 个 verifier tests；公开 snapshot `f2b6e62`；run `32438973147` |

## 首次冻结结论

无凭证可继续完成的缺口集中在：统一版本/兼容清单、packaged CLI 双向 E2E、渠道/下载/更新注入配置、单一 dry-run 报告、稳定路径与卸载边界、迁移失败恢复，以及分发兼容回归契约。Developer ID、公证和 Intel 真机人工走查保留为外部阻断，但其注入点与严格验证路径必须在本地先完成。
