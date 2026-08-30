# M36 固定组件方案清单

## 共同边界

- 上游：`anthropics/skills`
- 固定提交：`3b3fad96af16a10759d930941b4520ba0c40edae`
- 平台：`darwin-arm64`、`darwin-x64`
- 安装动作：只复制并校验 `SKILL.md` 与同目录 `LICENSE.txt`；不 clone、不安装依赖、不执行脚本
- 验证方法：`pinned-sha256-content-smoke-v1`
- License：Apache-2.0；绝大多数 License SHA-256 为 `bc6b3af2f331cbc7fb0da1344efb2cbe5877a31498b4d70dbc7000f3405a1362`，`frontend-design` 为 `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`

## 方案与工件

| Recipe ID | SKILL.md SHA-256 | 完整度 |
| --- | --- | --- |
| `anthropic-algorithmic-art` | `3bc4092c09804853186524c826bc0621b940bb6122c05b84496dff95388e6eef` | instructions-only；不复制必需 templates |
| `anthropic-academy-guide` | `f27992510c051355dfe68c92394d509af730da5298094ec86834ee40bbd31376` | complete；外部课程目录离线时不可用 |
| `anthropic-brand-guidelines` | `1120b3769e2985cefb3d25be981b1f914abeba57ae079b83c20c666c164fa9fe` | complete |
| `anthropic-canvas-design` | `a1f288079624402f30682753c1d43920b6664785698d21d3e7aa197450a6448b` | complete |
| `anthropic-discernment-nudge` | `9191177c4a8ef11a20dace786d708506b22d43e748c71287bb823de0dc812dad` | complete |
| `anthropic-frontend-design` | `1608ea77fbb6fc30d13a97d12cfa8ebf31358d40f0dd97beed24829d6b3f45dd` | complete |
| `anthropic-internal-comms` | `067b7587a344a928fc6534ef66b1bcd591fc7c26d207ea7ca3334aeb678d6475` | complete |
| `anthropic-mcp-builder` | `0f4592dcb53cf2b5d6b7febee6b4152018b565551a1c29e3c612f57b218ab295` | complete；不安装 SDK/依赖 |
| `anthropic-skill-creator` | `dcd4803e61e913e6fc27294184cd3a71f09f5e924ff20c8a9a20173e7b3c2bcf` | instructions-only；不复制 references/assets/eval tools |
| `anthropic-theme-factory` | `c35893e221e28895c52143cc11bf30e41a44817796b39d4b15727dadc9796552` | complete |
| `anthropic-web-artifacts-builder` | `81c5002c6643b0de7b8710b00e7a9038daa6fb9b68d59870ee6adb12da8d10f8` | instructions-only；不复制或执行 init/bundle scripts |
| `anthropic-webapp-testing` | `51b7349e77ec63b7744a6f63647e7566a0b4d2e301121cc10e8c2113af6556a2` | instructions-only；不复制或执行 Playwright/server helpers |

## Harness 能力矩阵

| Harness | complete 方案 | instructions-only 方案 | 接线路径 |
| --- | --- | --- | --- |
| Pi `0.84.2` | native | degraded | 固定 `--skill` 文件 |
| OpenClaw `>=2026.1.30` | adapted | degraded | Studio Profile 显式消息上下文 |
| Codex CLI `0.148.0-alpha.9` | adapted | degraded | 隔离的 `codex exec` Prompt 上下文 |

`unavailable` 不会进入安装按钮。`degraded` 的缺失辅助文件逐方案展示，Studio 不静默下载或执行它们。内容接线 Smoke Test 只证明 Markdown/frontmatter/hash、Profile 写入和 Harness 映射；它不冒充带模型凭证的行为质量测试。

## 2026-08-23 本机证据

- 官方 pinned tree 的 12 组 `SKILL.md` / `LICENSE.txt` 全部下载并复算 SHA-256。
- Codex 项目经包构建前的真实 CLI 依次安装 12/12 方案，revision 1→13；`customize check` 全部为 `current`。
- `anthropic-brand-guidelines` 在 Codex 与 OpenClaw 两个项目以相同 artifact SHA-256 通过内容接线 Smoke，分别明确为 `adapted`。
- Codex 项目卸载该 Skill 后 revision 13→14，使用 opaque snapshot ID 恢复到 revision 13；Renderer 无法提交 snapshot path。
- 自动化覆盖漂移检测、受控更新、更新后 Smoke 失败恢复、卸载复读、恢复、revision 冲突入口与严格 IPC。
