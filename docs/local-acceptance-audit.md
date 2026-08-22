# 本地验收审计

## 1. 目的与边界

本审计把“没有遗留占位”和“主要入口可达”变成每次 `npm run check` 都执行的门禁。它不把测试替身当作产品实现，也不替代领域、IPC、Renderer 或 packaged E2E 测试。

配置位于 `config/local-acceptance.json`，只允许对当前本地产品已经存在且有明确用途的输入提示和最终包验收控制进行分类。新增项必须同时说明文件、精确值或 token 以及用途。

## 2. 自动拒绝项

`npm run verify:local-acceptance` 扫描所有 production TypeScript/TSX/MJS（包括尚未提交但未忽略的文件），并拒绝：

- `TODO`、`FIXME`、`HACK`；
- `coming soon`、`not implemented`、“待实现”、“稍后提供”等用户可见占位文案；
- `onClick={() => undefined}` 一类死操作；
- 未在配置中逐项说明的输入 `placeholder`；
- 未分类的 `STUDIO_CAPTURE_*`、`STUDIO_E2E_*`、`STUDIO_PACKAGED_*` 或 `STUDIO_SMOKE_*` 旁路；
- 缺失、禁用、没有 Renderer 分支或不能从命令中心检索的一级导航。

当前审计结果为 6 个一级可达目的地、6 个输入提示和 2 组最终包验收控制，未处置项为 0。源文件数由 `verify:local-acceptance` 每次动态输出。`fixture` 只允许位于测试树或最终 packaged E2E 输入；Main 中的验收控制只改变临时数据根、截图/导出目标或启动检查，不替换 Studio Core、SQLite、项目协议、Runtime 或 CLI。

## 3. 可访问性证据

- `accessibility-contract.test.ts` 计算正文、按钮、错误、成功和警告组合的 WCAG AA 对比度，并检查 3px 可见焦点、`.sr-only` 与 `prefers-reduced-motion` 退化。
- Dialog 组件测试覆盖初始焦点、Tab/Shift+Tab 焦点约束、Enter 与 Escape。
- 最终 `.app` 通过 Chromium Accessibility Tree 检查主导航与 `main` landmarks、6 个一级入口、顶栏当前项目、全局搜索和创建操作；所有可见按钮必须有名称。
- packaged E2E 逐个聚焦并打开 6 个一级入口，验证对应 `h1` 与 `aria-current=page`，输出 `NAVIGATION_REACHABILITY VERIFIED (6)` 和 `PACKAGED_ACCESSIBILITY_TREE VERIFIED`。

## 4. 明确分类

输入框中的 6 个 placeholder 都是标签之外的格式/搜索提示，不承担唯一名称；Secret 表单、目录筛选、实验筛选、命令中心和公开来源搜索均另有可访问 label。

`STUDIO_PACKAGED_E2E` 等控制仅由最终 `.app` 黑盒脚本使用。验收仍启动 electron-builder 产物、实际 Main/Preload/Renderer、真实 SQLite/项目文件、独立 Runtime 子进程和包内 CLI；没有 mock Core、mock IPC 或 mock Runtime 成功路径。
