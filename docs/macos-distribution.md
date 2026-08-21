# macOS 分发、升级与数据恢复

## 1. 支持范围

- 当前 `package.json` 声明的 Agent Stack Studio 版本仅支持 macOS 12 Monterey 及更高版本。
- 本地打包产物与构建机架构一致。Apple Silicon 与 Intel 产物必须分别在对应的 macOS 构建机上运行相同检查。
- M6 不引入自动更新服务、远程后台或新的网络权限。升级通过用户主动安装更高版本完成。
- M7 随应用打包同版本 `studio` CLI。应用展示包内准确路径，但不修改 PATH、Shell profile 或用户的命令解析配置。
- 最终 GUI 可以通过 `--project <path>` 显式打开 CLI 管理的同一项目；该启动参数不修改项目格式、IPC 或 Renderer 权限。

## 2. 构建产物

```bash
npm ci
npm run check
npm run package:mac       # 生成当前架构的 DMG 和 ZIP
npm run package:mac:dir   # 只生成用于本地启动检查的 .app
npm run verify:mac-package
npm run test:e2e:packaged
```

M14 的打包 E2E 会直接运行 `.app` 内 `studio` CLI，使 GUI 通过 `--project` 读取同一临时项目，并验证 revision 0→1→2→3 的 CLI↔GUI 往返。这一过程不写 PATH，不使用外部服务，也不执行导入 fixture 中的代码。

打包配置固定了 Bundle ID `studio.agentstack.desktop`、最低 macOS 12.0、Hardened Runtime 和 Electron 必要的 JIT entitlements。Electron Builder 负责生成 `.app` 和重建原生依赖，ZIP 与 DMG 分别由 macOS 自带的 `ditto` 和 `hdiutil` 生成。每次构建同时生成 `SHA256SUMS-<version>-<arch>.txt`。验证脚本读取实际 ASAR 检查 Renderer CSP 和 Main 默认拒绝标记，重算 DMG/ZIP 哈希，并检查 Bundle ID、系统版本下限、可执行文件、签名与公证票据。

发布清单可独立复核：

```bash
cd release
shasum -a 256 -c SHA256SUMS-<version>-arm64.txt
```

SHA-256 清单用于发现传输损坏或发布物被替换，不提供发布者身份保证，不能替代签名与公证。

## 3. 签名和公证边界

对外分发前必须使用 Developer ID Application 证书签名，然后由 Apple 公证并 staple 票据。`electron-builder` 只在构建机存在有效证书和下列任一组完整公证凭据时执行这些步骤：

- `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`；或
- `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`；或
- `APPLE_KEYCHAIN_PROFILE` （可选搭配 `APPLE_KEYCHAIN`）。

不得把证书、密码或 API key 提交到仓库。本地无凭证打包会产生可启动的验证边界，但不得对外标记为已签名或已公证。

发布校验使用严格模式：

```bash
STUDIO_REQUIRE_SIGNED=1 STUDIO_REQUIRE_NOTARIZED=1 npm run verify:mac-package
```

## 3.1 分发配置与无凭证 dry-run

`config/release.default.json` 是默认 local 渠道配置，通过 `schemas/release-config-v1.schema.json` 和运行时 Zod 校验。它不包含凭证。可以用 `STUDIO_RELEASE_CONFIG` 指定另一份配置，或只覆盖以下分发字段：

- `STUDIO_RELEASE_CHANNEL=local|alpha|beta|stable`
- `STUDIO_RELEASE_DOWNLOAD_BASE_URL=https://...`
- `STUDIO_RELEASE_UPDATE_FEED_URL=https://...`
- `STUDIO_RELEASE_REQUIRE_SIGNED=0|1`
- `STUDIO_RELEASE_REQUIRE_NOTARIZED=0|1`
- `STUDIO_RELEASE_REQUIRE_STAPLED=0|1`

URL 必须使用 HTTPS。公证策略不能脱离 Developer ID 签名，staple 策略不能脱离公证。当前 schema 强制 `automaticUpdates: false`；更新地址只是未来分发元数据，不导致应用请求网络。

```bash
npm run release:dry-run
```

该命令依次运行 `check`、CLI 打包、macOS 打包、包验证和打包 E2E，然后写入 `release/release-dry-run-<version>-<arch>.json`。无凭证 local 模式的结果为 `complete`，但 Developer ID、公证和 staple 分别是 `skipped`。`--reuse-package` 只供已完成全套构建后的快速重查，仍会重新验证最终包。

## 4. 升级与 SQLite 迁移

1. 更新前在“设置 > 创建备份”生成备份。
2. 退出旧版应用，使用新 DMG 将应用拖入 Applications 覆盖旧版。
3. 新版首次启动时，按 `schema_migrations` 从当前版本逐步执行事务式迁移。
4. 任一迁移失败时回滚当前迁移，应用不将数据库描述为升级成功。
5. 旧版应用如果发现数据库 schema 高于自身支持版本，会停止打开，不尝试降级或改写。

迁移测试从 v1 数据库连续升级到当前 v8，验证 Agent 记录与归档默认值保留、SQLite `integrity_check` 通过，并覆盖迁移失败回滚重试、幂等重跑和新版 schema 拒绝。

## 5. 备份内容

备份是一个可移动文件夹，包含：

- SQLite 一致性快照 `studio.sqlite3`；
- `workspaces/`；
- `artifacts/`；
- `backup-manifest.json`，记录应用版本、schema 版本、每个文件的 SHA-256 与字节数。

明确排除：

- macOS Keychain 中的密钥原文；
- 应用日志；
- 符号链接及其指向的外部内容。

SQLite 内的 Keychain 服务/账户引用会进入备份，恢复到另一台 Mac 后需要在当地 Keychain 重新配置对应密钥。

## 6. 恢复流程

1. 打开“设置 > 从备份恢复”，选择备份文件夹。
2. Studio 检查清单 schema、SQLite 完整性、外键、数据库哈希和所有数据文件哈希。
3. 如果备份由更新版应用创建，恢复会被阻断。旧 schema 备份会明确显示重启后迁移的目标版本。
4. 用户勾选替换确认后，Studio 将已验证备份复制到内部待恢复区并重启。
5. 下次启动在任何 Repository 打开前创建“恢复前自动备份”，然后替换 SQLite、工作空间和产物。文件替换失败会回滚到原数据。
6. 恢复后的数据库按正常启动路径迁移到当前 schema。

自动回滚备份保存在 Application Support 下的 `recovery/`，不会被后续手动备份嵌套收集。

## 6.1 本地路径与卸载

Main 进程从 Electron `app.getPath('userData')` 解析唯一 Application Support 根目录，并固定派生 `studio.sqlite3`、`workspaces/`、`artifacts/`、`recovery/` 和 `logs/`。“设置 > 存储与卸载边界”显示当前机器的精确路径和备份范围。Finder 操作只接受六个枚举位置 ID，Renderer 不能传入任意文件路径。

标准卸载只需退出应用并将 `Agent Stack Studio.app` 移到废纸篓。为防止意外丢数据，卸载不会自动删除：

- Application Support 中的 SQLite、Workspace、Artifact、Recovery 和日志；
- 用户在应用外选择的 `.agent-stack` 项目文件；
- macOS Keychain 中服务名为 `studio.agentstack.desktop` 的密钥条目。

彻底移除前，先在设置中创建并验证备份，退出应用，再删除设置页所显示的 Application Support 根目录，最后在“钥匙串访问”中手动删除上述服务条目。Studio 不会为 CLI 静默修改 `PATH`；删除 `.app` 后，包内 CLI 也随之移除。

## 7. WCAG 2.2 AA 与键盘验收

每次 M6 发布至少验收：

- `Tab` / `Shift+Tab` 可按视觉顺序遍历主导航、页签、表单、表格行与主要操作；
- 跳转链接可直达主内容；
- Agent 详情页签支持左右方向键、`Home` 和 `End`；
- 对话框将焦点保持在内部，`Escape` 关闭后把焦点还给原操作；
- 创建 Agent、解决 Owner 冲突、启动/取消 Run、创建/启动/导出实验、发布确认、备份与恢复确认都可仅用键盘完成；
- 焦点外框、文本/背景对比、错误摘要、字段标签、状态图标+文字、表头语义均保留；
- 在 macOS“减少动态效果”启用时，非必要过渡降至近乎即时。

键盘自动化只是基线，打包应用仍需在真实 macOS 窗口中走查上述路径并截图复核中文界面。

## 8. M11 Keychain、图标与双架构证据

- `build/icon.icns` 是正式应用图标；验证器检查 Info.plist 的 `CFBundleIconFile` 和最终 Resources 文件。
- Agent 密钥原文只写入当前 Mac 登录钥匙串。SQLite 与备份保存引用；跨设备恢复会显示“本机缺失”，需要重新写入。
- `test:e2e:packaged` 实际启动最终 `.app`，验证中文设置页、Preload 白名单、Renderer 无 Node 并生成截图。测试调试端口只由该命令显式开启。
- 本地 Apple Silicon 运行 arm64 全套检查；GitHub `macos-15-intel` runner 运行 Intel x64 同一套 package、verify 和 E2E。发布记录必须分别保存两种结果。
- 当前不构建 Universal Binary，不静默修改 PATH，不引入自动更新。Developer ID 与公证仍按第 3 节外部凭据边界执行。

## 9. M18 项目包分发兼容边界

- Agent Stack Package v1 的 Schema 作为分发兼容资源进入最终 ASAR，`verify:mac-package` 检查其存在。
- 包的 producer version 直接读取 `package.json#version`；包格式版本、Schema ID 和 SHA-256 策略由 compatibility manifest 固定。
- 打包 E2E 在最终 `.app` 中完成 GUI 和包内 CLI 双向导出，复算哈希、扫描本机路径/敏感值，并输出 `SECRET_FREE_PORTABLE_PACKAGE VERIFIED`。
- 正式签名、公证、发布渠道或更新源不改变包 Schema、Core 导出语义、IPC 空输入契约或 GUI/CLI 操作路径。

## 10. 公开仓库与隐私边界

- 已共享的私有里程碑历史作为基线审计记录保留，不改写、不公开；历史中的作者元数据不会进入公开仓库。
- 公开仓库从隐私审计后的单提交快照开始，公开提交只使用 GitHub noreply 地址。私有里程碑提交与公开 CI 提交通过完全相同的 Git tree hash 关联。
- `npm run verify:public-snapshot` 扫描 Git 已跟踪和待提交文件，拒绝常见 Provider 凭证、私钥、非 fixture 邮箱、个人 macOS/Windows/Linux 用户路径及敏感文件名；该门禁已进入 `npm run check` 和 GitHub CI。
- M25 私有提交 `f525c4c` 与公开快照 `f2b6e62` 共享 tree `055a13a70b08eb088ae2d63558514bf7b7a8b7c8`；公开 Intel CI run `32438973147` 通过完整项目检查、打包、包验证、packaged E2E 和无凭证 dry-run。
