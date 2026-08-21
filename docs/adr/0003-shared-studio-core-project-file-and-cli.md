# ADR 0003：共享 Studio Core、项目文件与厂商无关 CLI

- 状态：已接受
- 日期：2026-08-20

## 背景

M0 至 M6 的 Electron Main 服务与 SQLite 已验证本地 Agent、实验、Run 和发布闭环，但 Coding Agent 若要参与组件导入、Stack 组装和版本冻结，不能依赖 Renderer，也不能把 Codex、Claude Code、Cursor 或任一厂商协议写入领域模型。GUI 与 CLI 若分别实现验证，还会产生两个不一致的事实来源。

## 决策

1. 新增不依赖 Electron Renderer 的 `StudioCore`。Electron Main 与产品级 `studio` CLI 都调用该 Core，能力覆盖、Owner、依赖、兼容性、删除保护和版本冻结只实现一次。
2. 项目根目录的 `.agent-stack` JSON 文件是 M7 可移植 Component、Stack、Owner 和 Version 定义的唯一可编辑事实来源。格式必须版本化、引用 JSON Schema，并使用 revision 乐观并发和同目录原子替换。
3. SQLite 继续保存本机项目路径索引、Run、Experiment、Receipt、Artifact、Multica 映射、Keychain 引用、偏好和维护记录。SQLite 不保存 `.agent-stack` 内对象的第二份可编辑副本。
4. `studio` CLI 是 Shell 契约，不是任何 Coding Agent 的专用插件。命令默认非交互，支持 `--json`、稳定错误码、幂等操作和结构化 `suggestedActions`。
5. 本地导入只读取明确安全的 JSON Manifest、README、license、Git remote/commit/status 和有限文件树。Studio 不执行依赖安装、setup、Hook、Makefile、Shell、二进制或 Runtime Adapter。
6. 证据结论依次区分 `declared`、`detected`、`user-confirmed`、`contract-tested`、`runtime-verified`。静态扫描不能把结论提升为契约测试或运行验证。

## 并发、迁移与恢复

- 每次写入携带期望 revision。磁盘 revision 不一致时返回 `REVISION_CONFLICT`，调用方必须重新读取。
- 写入先同步临时文件，再在同目录原子 rename；有效旧文件保留为 `.agent-stack.backup`。
- Core 可把格式 v0 迁移为 v1，并在主文件损坏时从最后有效备份恢复。迁移和恢复由 SQLite 维护记录索引。
- GUI 监视当前项目文件；CLI 或编辑器外部修改后，GUI 重新读取 Core 状态，不使用缓存覆盖磁盘。

## 结果

任意能调用 Shell 的人、Coding Agent 或 CI 可以管理同一份项目状态，GUI 仍保持 Renderer 无 Node 权限。代价是项目绝对路径与 Git 状态只适用于本机索引和来源证据，不能作为可移植领域身份；未来 GitHub 搜索由 M8 单独决策，不能改变 M7 的无网络导入安全边界。
