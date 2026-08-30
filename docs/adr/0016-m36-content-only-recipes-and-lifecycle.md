# ADR 0016：M36 使用内容白名单扩展组件，并区分接线 Smoke 与行为 Smoke

- 状态：已接受，M36 实施中
- 日期：2026-08-23
- 依据：ADR 0014、未知第三方代码默认不执行、M36 组件覆盖与恢复要求

## 背景

M36 需要约 10–15 个真实组件方案、跨 Harness 能力矩阵、更新、Smoke Test、卸载和恢复。上游 Skill 仓库既有纯 Markdown 说明，也有依赖 templates、references、assets 或 scripts 的 Skill。若只复制 `SKILL.md` 却标记完整，会制造兼容性；若自动 clone/build/运行辅助脚本，则越过已接受的安全边界。

## 决策

1. 注册表扩展到 12 个来自 `anthropics/skills` 的固定方案。每个方案保存 commit、artifact/license URL 与 SHA-256、SPDX License、macOS 平台、能力、完整度、限制、逐 Harness 支持级别和验证方法。
2. 安装仍是 content-only。`complete` 表示该 Markdown 方案不要求仓库内额外文件；`instructions-only` 表示说明可安装，但引用的辅助文件不复制，因此对每个 Harness 明确为 `degraded`。
3. Pi 以原生 `--skill` 加载 complete 方案；OpenClaw 与 Codex 在当前 Host Driver 中以显式 Profile/Prompt 上下文适配。这个矩阵不声称三个 Harness 的能力相同。
4. 更新检测只比较当前 App 内已审计的 pinned recipe 与项目内容。Studio 不联网猜测“最新版本”，recipe 升级必须随 Studio 注册表审计更新。
5. 内容接线 Smoke Test 验证 frontmatter、artifact hash、启用状态、项目复读和 Harness 映射，并明确 `executedThirdPartyCode:false`。模型行为 Smoke 是更高层证据，需要对应 Harness 凭证，不能由内容 Smoke 冒充。
6. 安装/更新/卸载前创建 `0600` 快照。Renderer 只持有 UUID snapshot ID；Main 从当前项目旁的固定目录解析，拒绝任意 path 与符号链接。更新/卸载写后验证失败自动恢复，显式恢复仍受 expected revision 保护。

## 后果

用户获得可审计、可回滚的真实组件目录，而不是推荐系统或公共市场。部分方案会显式显示降级，这是保持安全与证据真实性的代价。未来若要完整安装模板或脚本，必须新增逐文件哈希、受控权限和独立 ADR，不能扩大当前 content-only 方案的含义。
