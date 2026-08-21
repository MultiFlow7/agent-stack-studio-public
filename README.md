# Agent Stack Studio

Agent Stack Studio 是一个仅面向 macOS 的本地桌面工具，用于识别、组合、替换和实验 Agent Stack 中的各个模块。

它解决的核心问题不是重新实现一套 Agent Framework，而是把 Pi、OpenClaw、LangGraph 或自研 Harness 中已经包含的能力标注出来，让用户看见哪些模块已被占用、哪些模块可以替换，并在保持控制变量不变的前提下比较其他模块。

公开仓库为 [MultiFlow7/agent-stack-studio-public](https://github.com/MultiFlow7/agent-stack-studio-public)。它从通过隐私审计的 M25 快照开始；早期里程碑的私有审计历史不会复制到公开仓库。`npm run verify:public-snapshot` 会在每次完整检查中拒绝凭证、私钥、真实邮箱、个人用户路径和敏感文件名。

## 产品边界

- 每位用户在自己的 Mac 上独立安装和运行。
- Agent、组件、实验、运行记录和密钥保存在本地。
- 团队共享、成员权限、任务分发和协作继续由 Multica 承担。
- Studio 通过 Connector 把确认后的 Agent Version 发布到 Multica。
- Studio 不修改、复制或依赖 Multica 的前端代码。

## 文档入口

- [产品原则](./PRODUCT.md)
- [产品需求](./docs/product-requirements.md)
- [界面与交互规格](./docs/ui-spec.md)
- [技术架构](./docs/technical-architecture.md)
- [组件能力模型](./docs/component-model.md)
- [实验与可复现性](./docs/experiments.md)
- [Multica 集成](./docs/multica-integration.md)
- [开发路线图](./docs/roadmap.md)
- [架构决策](./docs/adr/0001-local-first-macos-desktop.md)
- [Studio 项目文件](./docs/studio-project-format.md)
- [Studio CLI](./docs/studio-cli.md)
- [GitHub 公开来源发现 ADR](./docs/adr/0004-github-public-discovery-and-handoff.md)
- [Electron 与发布完整性 ADR](./docs/adr/0005-default-deny-electron-and-release-integrity.md)
- [不可变项目版本完整性 ADR](./docs/adr/0006-immutable-project-version-integrity.md)
- [macOS 钥匙串与发布就绪 ADR](./docs/adr/0007-macos-keychain-and-release-readiness.md)
- [本地可信执行 Profile ADR](./docs/adr/0008-local-trusted-execution-profiles.md)
- [术语表](./docs/glossary.md)
- [本地产品完整性矩阵](./docs/local-completeness-matrix.md)
- [正式分发架构就绪矩阵](./docs/release-readiness-matrix.md)
- [本地验收审计](./docs/local-acceptance-audit.md)

当前仓库已实现 M0 至 M28 的可运行纵向切片。M28 把 97 条本地需求、39 条分发需求、8 条八状态用户旅程和 23 张本地中文打包截图组成机器可核验证据台账，并默认拒绝公开 snapshot 中未审核的二进制。M27 把 TODO/FIXME、占位/死操作、测试旁路和断路导航变成自动拒绝门禁，并在最终 `.app` 中遍历 7 个入口、检查 Chromium 可访问树。Studio 不自动下载或执行候选仓库；项目 Workflow 和处置任务都不会自动获得 Runtime 信任。真实 Multica Transport 仍需在确认官方认证与接口后接入。

## 本地开发

需要 Apple Silicon 或 Intel Mac、Node.js 24 及 npm 11。依赖使用精确版本和 `package-lock.json` 锁定。

```bash
npm ci
npm start
```

常用验证命令：

```bash
npm run check        # 格式、Lint、类型、单元测试和生产构建
npm run package:mac  # 生成当前架构的 DMG、ZIP 和 SHA-256 清单；有凭证时才签名/公证
npm run package:mac:dir  # 生成便于本地启动检查的 .app
npm run verify:mac-package # 检查包安全契约、发布哈希、元数据、签名和公证边界
npm run package:cli  # 构建并检查与应用同版本的 studio CLI
npm run test:e2e:packaged # 实际启动已打包 .app 并检查中文设置页与 Renderer 边界
npm run release:dry-run # 无凭证也运行全套检查并生成结构化分发报告
npm run verify:public-snapshot # 检查待公开快照中的凭证与个人信息
npm run verify:local-acceptance # 拒绝未分类占位、测试旁路与断路导航
```

工程边界位于 `src/renderer`、`src/preload`、`src/main`、`src/runtime` 和 `src/shared`。Renderer 只能访问 Preload 暴露且经 schema 校验的白名单 API；SQLite、工作区、原生目录选择器和 Runtime 子进程均由 Main 管理。每次正式 Run 都创建全新的 Runtime 子进程，Cordis 类型不会进入领域模型或 UI。

M6 的安装、签名/公证边界、升级、备份恢复和键盘验收见 [macOS 分发说明](./docs/macos-distribution.md)。

CLI 不会修改 PATH。构建后可直接运行 `dist/cli/studio.mjs help`；打包应用会在“Studio 项目”页显示应用包内的准确命令路径。

打包 GUI 可在启动时直接打开 CLI 管理的同一项目：

```bash
"/Applications/Agent Stack Studio.app/Contents/MacOS/Agent Stack Studio" --project /path/to/project
```

项目历史审计：

```bash
studio project audit --project /path/to/project --json
```

导出经过哈希验证、不含 Keychain 密钥和本机数据的可移植包：

```bash
studio project export --project /path/to/project --output ./my-stack.agent-stack-package.json --json
```

创建结构化 Workflow DAG：

```bash
studio workflow create --name "研究流水线" --project /path/to/project --json
studio workflow node-add <workflow-id> --kind operation --name "准备" --ref prepare-input --project /path/to/project --json
studio workflow edge-add <workflow-id> <from-node-id> <to-node-id> --project /path/to/project --json
studio workflow freeze <workflow-id> --project /path/to/project --json
```

通过标准输入写入 macOS 钥匙串，原文不会进入参数或 JSON 输出：

```bash
printf '%s' "$SECRET" | studio secret set openai-api --stdin --json
studio secret status openai-api --json
```

公开来源发现示例：

```bash
studio source search "agent component" --sort stars --json
studio source inspect owner/repository --json
studio source handoff owner/repository --destination ./vendor/repository --json
```
