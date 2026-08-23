# ADR 0017：M37 用 App 内置运行时分发 CLI，并共享 Doctor 诊断事实

- 状态：已接受，M37 实施中
- 日期：2026-08-23
- 依据：ADR 0003、ADR 0005、ADR 0011、M37 无开发环境分发与诊断要求

## 背景

原打包 App 只展示 `app.asar.unpacked/dist/cli/studio.mjs`。该文件的 shebang 依赖系统 `node`，因此在没有 Node.js/npm/开发仓库的目标 Mac 上不能作为产品 CLI。同时，`studio doctor` 仅是旧 `project audit` 的别名，不能说明 App、CLI、数据迁移、Harness 和 Multica 的就绪度。

## 决策

1. Electron Builder 在签名前把 `Contents/Resources/bin/studio` 作为可执行 `extraResources` 写入 App。启动器以 `ELECTRON_RUN_AS_NODE=1` 运行包内 CLI 脚本，不调用系统 Node.js。
2. 启动器不修改 PATH 或 Shell profile。它传递包内启动器身份，并在未显式覆盖时使 CLI 与 App 使用同一 Application Support 根目录。`--data-dir`/`STUDIO_USER_DATA_PATH` 仍是可审计的显式覆盖。
3. 包验证和 packaged E2E 把 PATH 限制为 `/usr/bin:/bin`，并直接执行启动器。只检查文件存在不构成验收。
4. Doctor 由共享 Zod Schema 和纯 `buildStudioDoctorReport` Core 聚合。GUI Main 和 CLI Host 只采集主机事实；Renderer 不读取文件、数据库、可执行文件或凭证。
5. 诊断返回 `ready/degraded/blocked`、稳定 check ID、计数、安全摘要和修复建议。Harness 检查只表达 Host Driver/CLI 版本就绪，不调用模型、不冒充凭证或行为 Smoke；Multica 检查真实验证最低 CLI 版本、认证和在线 Runtime。
6. Doctor 是只读操作。它不执行未知代码、不自动登录、不上传项目，也不在出错时伪造成功。

## 后果

最终 App 的 GUI 和 CLI 共享项目事实与本机发布映射，且目标 Mac 无需安装开发工具。Doctor 能将可安全修复的问题与 Developer ID、Apple 公证、Harness/Multica 凭证等外部门禁分开；真实运行和发布仍需独立 E2E 证据。
