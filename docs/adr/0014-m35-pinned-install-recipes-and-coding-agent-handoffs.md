# ADR 0014：M35 固定安装方案与 Coding Agent 交接

- 状态：已接受，M35 实施中
- 日期：2026-08-23
- 依据：ADR 0011、M32–M37 产品边界

## 背景

Studio 要让不会写代码的用户安全扩展 Agent，但不能把“GitHub URL”等同于“可信可执行组件”。GitHub 仓库可以随时变化，包安装脚本、Hook、二进制和依赖树都会扩大本机权限。因此，M35 需要把“已知可安装内容”与“未知、待工程适配来源”分成两条路径。

## 决策

1. Studio Core 保持一个代码内精确注册的 `InstallRecipe` 列表。每个方案固定仓库、40 位 commit、Artifact 路径与 SHA-256、License 与 SHA-256、Harness 能力矩阵及执行策略。不接受远端动态方案。
2. GitHub URL/`owner/repo` 识别只解析安全 locator，不 clone。本地目录识别只读固定相对路径、Git remote 文本与文件哈希；拒绝符号链接目录，不运行脚本。
3. M35 首个真实方案是 Anthropic `algorithmic-art` Markdown Skill：固定 `anthropics/skills@3b3fad96af16a10759d930941b4520ba0c40edae`，Skill SHA-256 为 `3bc4092c09804853186524c826bc0621b940bb6122c05b84496dff95388e6eef`，Apache-2.0 License SHA-256 为 `bc6b3af2f331cbc7fb0da1344efb2cbe5877a31498b4d70dbc7000f3405a1362`。只下载/复制这两个文本文件，不执行仓库代码。[official repository](https://github.com/anthropics/skills)、[pinned Skill](https://github.com/anthropics/skills/blob/3b3fad96af16a10759d930941b4520ba0c40edae/skills/algorithmic-art/SKILL.md)、[pinned license](https://github.com/anthropics/skills/blob/3b3fad96af16a10759d930941b4520ba0c40edae/skills/algorithmic-art/LICENSE.txt)
4. 安装之前把当前 `.agent-stack` 复制到 `.agent-stack-local/install-snapshots`，权限为 `0600`。下载与校验失败是零写入；写入后 Smoke Test 失败时，Core 在项目锁和 revision 保护下原子恢复快照。如果又有新修订，拒绝覆盖并保留人工恢复路径。
5. 未知来源只生成 Markdown 定制任务，必须包含来源/Harness 事实、安全边界、能力映射、版本/校验/License、文件计划、测试、回滚和验收。Studio 不排队、不自动执行任务。

## GUI / CLI / Core / 事实 / 验收

- GUI：“发现组件来源”页提供 URL/本地目录静态识别、Harness 选择、方案证据、确认安装、取消、任务预览/复制和失败状态。
- CLI：`studio customize inspect|task|install`；`task --output` 写入 Markdown，`install` 必须同时提供 `--harness --revision --confirm`，本地固定来源使用 `--source`。
- Core：同一 recipe registry、识别、任务生成、快照/恢复与 Profile 原子写入。IPC 不允许 Renderer 提交项目路径；Main 注入当前打开项目。
- 项目事实：安装后 Skill Markdown 进入 `.agent-stack.profile.skills`；操作快照留在 `.agent-stack-local`，不进入发布 payload。不可变 Version 不改写。
- 验收：真实官方固定 URL 安装返回 `executedThirdPartyCode:false`、准确 hash、revision 1→2 和 Smoke passed；自动测试覆盖本地识别、幂等、篡改零写入、写后失败恢复、未知任务和 IPC 路径隔离。
