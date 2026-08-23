# M33–M37 真实外部验收 Runbook

## 1. 用途与安全边界

这份 runbook 只用于关闭仓库代码无法自行制造的外部事实：第二个真实 Harness 行为、真实 Multica 远端、Intel Mac、Developer ID 和 Apple 公证。执行前必须由用户明确授权安装和远端写入，并由用户在对应工具的原生登录流程中完成认证。

- 不把 Token、模型密钥、Multica 配置、聊天全文或本地绝对路径提交到仓库、CI 日志或截图。
- 不用 fake executable、Contract Test target、Harness probe 或认证失败 smoke 代替真实成功。
- 所有项目写入继续使用 revision；所有发布继续使用冻结 Version 和明确 `--confirm`。
- 验收副本使用独立临时项目与私有 Multica Agent，不改用户现有生产 Agent。

## 2. 固定工具与前置检查

最终 App 内 CLI 路径为：

```bash
/Applications/Agent Stack Studio.app/Contents/Resources/bin/studio
```

下文的 `studio` 均表示这个绝对路径；Studio 不修改 PATH 或 Shell profile。

当前支持的外部版本：

- Pi：`@earendil-works/pi-coding-agent@0.84.2`，从官方 npm registry 获取；包 integrity 固定为 `sha512-l4E+B7hgXKWddRo8bC/eSue2aWZjEgJ9xIpf5p0Og+lq8a2TArCwJ0HCoCPCgaBP/tN4zbYH/wOwvx9pJpeLCA==`，Node 要求 `>=22.19.0`。
- OpenClaw：`>=2026.1.30`。
- Codex CLI：`0.148.0-alpha.9`。
- Multica CLI：`v0.4.32`。官方 macOS arm64 release SHA-256 为 `27aea9925984f4343771bc03df9611df3c5fea658126514528412fffdee2ff63`；安装说明以 [Multica CLI_INSTALL](https://github.com/multica-ai/multica/blob/main/CLI_INSTALL.md) 为准。

只读前置检查：

```bash
"/Applications/Agent Stack Studio.app/Contents/Resources/bin/studio" doctor --project /path/to/acceptance-project --json
multica version --output json
multica auth status
multica daemon status --output json
multica runtime list --output json
```

Doctor 的 `ready` 只证明版本/认证/Runtime 前置条件，不证明模型回复或远端发布成功。

## 3. M33：两个不同 Harness 的真实 Run 与 Chat

对两个不同 Harness 分别建立独立验收项目；当前目标是 Pi 与 OpenClaw，Codex 的既有 M36 行为证据不能掩盖 Pi/OpenClaw 尚未成功。以下命令中的路径和 revision 必须来自前一步真实输出：

```bash
studio agent create /path/to/pi-acceptance --name "M33 Pi Acceptance" --json
studio harness select pi --project /path/to/pi-acceptance --revision <revision> --json
studio run start --project /path/to/pi-acceptance --message "Reply with M33_RUN_OK only." --idempotency-key m33-pi-run-v1 --json
studio chat send --project /path/to/pi-acceptance --message "Reply with M33_CHAT_ONE only." --json
studio chat send --project /path/to/pi-acceptance --session <session-uuid> --message "Reply with M33_CHAT_TWO only." --json
```

OpenClaw 项目使用相同顺序，把 Harness 换为 `openclaw`。每个 Harness 的证据必须同时满足：

1. `data.status` 为 `succeeded`，`data.harness` 是目标 Harness，`harnessVersion` 满足固定范围。
2. Run 为非交互调用；相同 idempotency key 重试返回同一本机结果，不产生第二条执行事实。
3. 两次 Chat 使用同一个 `sessionId`，第二次回复证明真实会话延续。
4. `projectHash` 是当前项目事实的 SHA-256；聊天/回复只保存在 `.agent-stack-local`，不进入冻结 Version。
5. 至少一个项目包含 Prompt、Markdown Memory、Skill；MCP 仅在 Harness 支持且用户已批准的情况下验收，降级必须逐项显示。

保存证据时只保留状态、Harness/version、session/request ID、usage、project hash 和脱敏后的短响应；不得保存 Provider 凭证或原始 stderr。

## 4. M34：真实 Multica 幂等发布

先由用户在 Multica 原生流程中完成 `multica setup` 或 `multica login`，并启动 daemon。不要把 Token 放入命令参数、Studio 配置或证据文件。随后：

```bash
studio agent freeze --project /path/to/acceptance-project --revision <revision> --json
studio publish runtimes --project /path/to/acceptance-project --json
studio publish validate --project /path/to/acceptance-project --version <version-uuid> --runtime-id <runtime-uuid> --json
studio publish publish --project /path/to/acceptance-project --version <version-uuid> --runtime-id <runtime-uuid> --confirm --json
studio publish status --project /path/to/acceptance-project --version <version-uuid> --json
```

然后对同一 Version 重复一次 `publish publish --confirm`。完成证据必须证明：

1. GUI 与 CLI 显示完全相同的 Version ID、规范 payload SHA-256 和远端 Agent ID。
2. 首次 create、丢失响应后的安全重试以及普通重复发布都只对应一个远端 Agent；重复调用更新或找回同一身份。
3. `status` 重新执行真实 `agent get`，远端 instructions 标记中的 Version/hash 与本地冻结 Version 相同。
4. 本地项目路径、Keychain 引用/值、聊天、Run/Experiment 日志和 Artifact 不在 payload 或远端 instructions 中。
5. Receipt 只记录脱敏响应；失败重试不改变 `.agent-stack` revision。

GUI 还需在同一项目的“发布”页选择同一 Runtime，确认 payload 范围，并保存包含 Version/hash/远端状态但不含本地路径或聊天内容的截图。

2026-08-23 已完成的 CLI 证据：官方 arm64 v0.4.32 校验安装；现有原生登录态与在线 Pi Runtime 只读确认；`STUDIO_MULTICA_REAL_ACCEPTANCE=1 npm run test:e2e:multica-real` 返回 `REAL_MULTICA_PUBLISH_E2E VERIFIED`。脱敏证据证明 validate ready、首次 succeeded、重试 reused、同一远端身份指纹、status in-sync 和 local/remote hash 相同。临时项目/SQLite 已删除，私有远端验收 Agent 保留供远端事实审计；证据不含其原始 ID、Runtime/工作区/本机身份、路径、凭证、Prompt、响应、聊天或日志。

## 5. M37：正式 macOS 与无开发环境终验

在没有 Node、npm 和开发仓库的受支持 Mac 上，从最终 DMG 安装 `.app`：

1. 验证 Developer ID 签名、Apple notarization 和 stapled ticket。
2. 启动 GUI，完成创建 Agent、选择 Harness、配置最小 Prompt/Skill/Memory、真实 Chat/Run、冻结和 Multica 发布。
3. 直接运行 App 内 `Contents/Resources/bin/studio`，确认它与 GUI 读取同一项目 revision、Version/hash、Receipt 和远端状态。
4. 运行 `studio doctor --json`；App、包内 CLI、SQLite、备份恢复、项目、所选 Harness 和 Multica 均不得有 blocker。
5. 创建备份，执行升级/迁移和恢复；旧 Experiment/Workflow 默认保持只读，只有显式迁移模式可写。
6. arm64 与 Intel x64 分别保存 package/verify/E2E 结果，不把单架构结果称为 Universal 或另一架构通过。

Intel GitHub CI 必须从待发布精确 HEAD 运行同一 `check`、package、verify、packaged E2E 和 release dry-run。当前账户 Billing 阻断恢复后重新触发；历史 0-step job 不能作为代码通过或失败证据。

## 6. 完成判定

只有以下证据同时存在，M33、M34、M37 才能改为完成：

- 两个不同目标 Harness 的真实、带授权模型行为 Run + session Chat 成功证据；
- GUI/CLI 对同一冻结 Version 的真实 Multica create/update/get、同 hash、同远端身份与幂等重试证据；
- arm64 与 Intel x64 最终包证据、Developer ID、公证/staple、无开发环境 Mac GUI+CLI+Multica 闭环；
- 最终 HEAD 的完整本地检查和 GitHub CI 通过。

缺少任一项时保持 `pending`、`partial` 或 `external-blocked`，不得用本地 Contract Test、跳过项或已有另一 Harness 的成功结果替代。
