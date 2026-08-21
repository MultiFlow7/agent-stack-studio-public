# ADR 0007：macOS 钥匙串与发布就绪验证

- 状态：已接受
- 日期：2026-08-20

## 背景

M1 已建立 SQLite 密钥引用表，M6 备份也明确排除密钥原文，但此前没有真实的系统钥匙串 Adapter。界面只展示“密钥保存在 Keychain”的说明，会把尚未实现的边界误表述为能力。发布侧也仍使用 Electron 默认图标，且缺少对最终 `.app` 的自动化交互冒烟。

M11 不扩大第三方执行权限，不引入云端密钥服务、自动更新服务或新的 Renderer 权限。Developer ID 与 Apple 公证仍依赖外部证书和凭据。

## 决策

1. `MacOsKeychainAdapter` 只调用系统固定路径 `/usr/bin/security`，使用参数数组而非 Shell。写入使用 `security` 的提示模式并从 stdin 提交两次密钥，使原文不进入进程参数。
2. SQLite 继续只保存服务、账户、用途和 Agent 引用。Renderer 只提交非敏感元数据；Main 使用固定 AppleScript 打开 macOS 原生隐藏输入对话框，并把结果直接交给 Keychain Adapter。Main 可为受信 Runtime 读取原文；Renderer IPC 不提供密钥输入或读取字段，所有输入输出均通过 Zod 白名单校验。
3. GUI 在 Agent 设置中提供加载、空、失败、缺失、替换、取消和内联删除确认。恢复到另一台 Mac 后，引用显示“本机缺失”，不会伪造已配置状态。
4. `studio secret set` 只接受 `--stdin`；`status` 和 `delete` 不输出原文。默认服务为 `studio.agentstack.desktop`，自定义服务必须显式传入。命令不修改 Shell 或系统配置。
5. macOS 应用使用仓库内正式 `.icns`，包验证器检查 `CFBundleIconFile` 和最终 Resources 中的图标。
6. 最终 `.app` 冒烟使用只在测试进程显式开启的 Chromium DevTools 端口。测试实际启动应用、检查 Renderer 无 Node、打开中文设置页并截图；产品运行不开放端口，也不新增 CSP 或 Session 权限。
7. 本地 Apple Silicon 与 GitHub `macos-15-intel` runner 执行相同构建、包验证和 E2E 契约。产物仍按版本与架构分离，不能把单一架构结果表述为 Universal Binary 或另一架构真机验证。
8. M15 增加纯分发层 compatibility manifest 和 release config。它们不进入领域、项目 Schema、SQLite、IPC 或 Runtime；自动更新仍强制禁用。
9. `release:dry-run` 在无凭证时运行完整本地链路并显式报告跳过的 Apple 步骤。严格发布策略会将缺少的签名、公证或 staple 标为阻断，不降级为警告。

## 结果

密钥引用从数据占位变为真实 macOS Keychain 闭环，且密钥原文不会进入 SQLite、Renderer、备份、CLI 参数或 JSON 输出。发布物具备正式图标和可重复的最终应用交互证据。

仍未解决的外部条件包括 Developer ID 签名、公证、Intel 真机人工走查和更新分发服务；缺少这些条件时必须继续明确报告未完成边界。
