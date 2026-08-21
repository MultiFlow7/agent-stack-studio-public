# ADR 0005：Electron 默认拒绝与发布物完整性

- 状态：已接受
- 日期：2026-08-20

## 背景

Studio 的 Renderer 已启用上下文隔离、沙箱并禁用 Node，但 Electron 的安全边界还需要在应用 Session、WebContents、IPC 来源和最终发布物上显式闭合。仅依赖 Chromium 或 Electron 的默认行为会让升级后的默认值变化难以及时发现，也无法证明 DMG、ZIP 内实际包含的构建仍符合源码安全策略。

M9 只收紧现有本地权限和分发验证，不申请新权限、不引入后台服务，也不扩大 GitHub 或第三方代码执行范围。

## 决策

1. Main 在 `ready` 前启用全局 Chromium 沙箱。每个 BrowserWindow 显式启用 `contextIsolation`、`sandbox`、`webSecurity`，禁用 Node、Worker/Subframe Node、WebView、不安全内容、实验特性和拖放导航。
2. 默认 Session 同时安装 permission check、permission request 和 device permission 处理器，全部返回拒绝。Studio 需要的新权限必须通过后续 ADR 和针对性测试单独开放。
3. Session 阻断所有 Renderer 下载；WebContents 阻断新窗口、顶层导航和 WebView 附加。公开来源下载仍只是 M8 的结构化交接数据，由人工 Shell 或 Coding Agent 审阅执行。
4. 所有 IPC invoke 在 Zod 输入校验前检查调用 Frame URL。只有应用本地 `file:` Renderer 可以进入白名单 Handler；远程或无法解析的来源统一拒绝。
5. Renderer CSP 显式拒绝网络连接、对象、表单提交、Frame、媒体和 Worker，并禁止 `unsafe-inline`、`unsafe-eval` 与 HTTP(S) 来源。
6. macOS 验证脚本直接读取打包 ASAR，检查最终 Renderer CSP 与编译后 Main 的安全标记，避免只验证源码。
7. 每次 macOS 打包为同版本、同架构的 DMG 与 ZIP 生成排序稳定的 SHA-256 清单。验证器要求清单文件集合完全匹配并逐文件重算哈希。
8. SHA-256 只能发现发布后篡改或传输损坏，不替代 Developer ID 签名和 Apple 公证。无凭证构建继续明确标记为未签名、未公证。

## 结果

Renderer 的权限、导航、下载和 IPC 来源从隐式默认值变为可测试的默认拒绝契约；本地与 CI 可以验证实际应用包及发布物完整性。代价是任何未来需要剪贴板读取、媒体、外部打开、下载或嵌入页面的功能，都必须显式修改安全模块、CSP、ADR 和测试，而不能只在 UI 中调用浏览器 API。
