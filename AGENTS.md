# Agent Stack Studio 开发约定

## 文档优先级

开始开发前必须阅读：

1. `PRODUCT.md`
2. `docs/product-requirements.md`
3. `docs/technical-architecture.md`
4. 与当前功能相关的其他 `docs/` 文档和 ADR

若代码实现与已接受 ADR 冲突，先提出决策问题，不得静默改写架构。

## 产品边界

- 第一版只支持 macOS。
- 产品是本地 Electron 桌面应用，不建设共享 Web 控制台。
- 不直接修改 Multica，不复制其前端代码或品牌资产。
- 团队共享只能通过明确的 Multica Connector 发布操作完成。
- Cordis 只存在于 Runtime 内核边界，不把 Cordis 类型扩散到领域模型和 UI。

## 开发方式

- 使用 TypeScript 严格模式和明确的领域类型。
- Renderer 禁止直接访问 Node.js、文件系统、数据库和密钥。
- 所有 IPC 输入必须进行 schema 校验。
- 科研 Run 默认使用全新 Runtime 子进程。
- 新增 Component、Adapter、Connector 或数据库迁移必须有测试。
- 实现用户工作流时同时覆盖空状态、加载、失败、取消和键盘操作。
- 界面遵守 WCAG 2.2 AA，并支持 macOS 减少动态效果。

## Git 与自动更新

- 使用 `codex/` 前缀的功能分支。
- 完成一个可验证的纵向切片后提交并推送到 GitHub。
- 推送前运行适用的格式、类型、测试和构建检查。
- 不使用强制推送，不改写已共享提交，不自动合并到 `main`。
- 测试失败时保留本地修复，不把失败状态描述为完成。

## 需要先沟通的事项

- 改变本地优先、macOS-only、Electron 或 Cordis 的核心选择。
- 引入团队账号、云数据库、后台服务或外部托管。
- 执行未知第三方代码、上传本地数据或扩大文件和网络权限。
- Multica 认证或发布能力需要不同于文档的集成方式。
- 需要付费服务、开发者证书、外部凭证或法律许可判断。
