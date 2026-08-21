# ADR 0006：不可变项目版本的读取时完整性校验

- 状态：已接受
- 日期：2026-08-20

## 背景

`.agent-stack` v1 的 Version 保存冻结快照和 `contentHash`，但此前只在创建时计算哈希，读取时仅校验字段格式。用户、编辑器或 Coding Agent 可以直接修改 JSON；如果 Studio 不重新计算，已被改写的历史仍会被界面和 CLI 表述为“不可变版本”。

M10 需要让不可变成为可验证契约，同时保持项目文件可移植、可人工检查，不引入账号、远程证明、代码执行或新的网络权限。

## 决策

1. Studio Core 在每次项目文件读取后，对每个 Version 的 `snapshot` 重新计算规范 JSON SHA-256，并与 `contentHash` 比较。
2. 同一次审计还检查版本号连续、Version ID 与快照哈希不重复、快照项目 ID、来源 revision、快照组件顺序和 Owner 引用等历史语义。
3. `project audit` 使用不恢复的只读路径。完整性失败返回稳定的 `PROJECT_INTEGRITY_FAILED`、退出码和结构化 `suggestedActions`，不得继续修改项目。
4. GUI 和普通 `project inspect` 保留 M7 的最后有效备份恢复能力。恢复前把无效文件保存为 `.agent-stack.invalid-*`，并在 GUI 明确提示用户人工比较。
5. GUI 与 CLI 使用同一份 Core `ProjectIntegrityReport`；Renderer 和命令适配层不得各自重算或复制判断。
6. 完整性报告说明算法、项目 revision、检查时间和每个 Version 的快照哈希。没有版本的项目也可以通过审计，结果明确为检查零个版本。
7. SHA-256 一致性不能证明作者身份，也不能抵抗能够同时改写快照与哈希的攻击者。M10 不把本地审计表述为签名、认证或供应链证明。

## 结果

Studio 不再接受哈希与快照不一致的冻结历史，机器调用方可以在 CI 或人工修改后运行稳定的只读审计，GUI 能展示相同结论及备份恢复状态。代价是旧项目中任何已经存在的不一致历史会被阻断，需要用户检查保留的无效文件与最后有效备份，而不是由 Studio 猜测哪份内容正确。
