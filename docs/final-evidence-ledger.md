# 最终本地证据台账

## 用途

`config/final-evidence.json` 是 M28 的机器可核验验收索引。它不新增产品功能，只把已冻结需求、用户旅程状态、中文打包截图、验证命令和包路径连成一个可回归的证据图。

## 八状态旅程

台账覆盖 8 条跨领域用户旅程：Studio Project、Agent、Component/Stack/Workflow、Runtime/Run、Experiment、来源发现、备份/恢复/Keychain 与工作区命令中心。每条都必须显式分类：

- 空、加载、成功、失败、取消、冲突、外部修改刷新和完整键盘路径；
- 真实可发生的状态标记为 `verified`，必须指向至少一个自动化测试或 packaged E2E；
- 只读或单写入边界下不存在的状态标记为 `boundary`，仍必须有原因和自动化边界证据，不能用“难以实现”代替。

## 截图与隐私

23 张中文截图全部由最终 `.app` 的 packaged E2E 生成，覆盖空、成功、失败、取消、冲突和外部刷新。它们是本机验收产物，固定位于被 Git 忽略的 `artifacts/` 中，不进入公开仓库。公开隐私门禁只允许两个已复核应用图标作为二进制文件，因此本地截图或其他不透明二进制一旦被跟踪会立即失败。

## 机器验证

- `npm run verify:evidence-ledger`：检查 97 条 LC、39 条 RR、8 条旅程、8 个状态维度、23 个截图生成器、9 条验证命令和 4 个包产物路径。
- `npm run verify:final-report`：在最终打包后额外要求本地可完成需求零未完成，且所有包与截图实际存在。
- `npm run generate:final-report -- --public-commit <sha> --ci-run <id> --ci-url <url>`：生成被 Git 忽略的 `release/final-local-completeness-report.json`，逐项写入需求 ID、证据、提交、命令、包、截图和 CI。

该台账不改变领域模型、项目/Package Schema、SQLite 职责、IPC、Runtime 协议、CLI 或 GUI 业务路径。
