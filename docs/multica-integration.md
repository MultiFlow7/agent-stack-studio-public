# Multica 集成边界

## 1. 职责划分

### Agent Stack Studio

- 本地创建和组合 Agent Stack。
- 管理组件覆盖、兼容性和实验。
- 在本地执行验证和研究 Run。
- 生成不可变 Agent Version。

### Multica

- 团队成员和访问权限。
- 任务分发、协作和共享工作状态。
- 团队可见的 Agent 身份及运行入口。

Studio 不建立第二套团队账号和共享服务器。

## 2. Connector Contract

Multica Connector 实现统一接口：

```ts
interface AgentPublisher {
  validate(target: PublishTarget, version: AgentVersion): Promise<ValidationResult>
  publish(target: PublishTarget, version: AgentVersion): Promise<PublishReceipt>
  inspect(target: PublishTarget): Promise<RemoteAgentSummary | null>
}
```

产品领域层只依赖 `AgentPublisher`，不依赖 Multica 的内部类型。第一版可以通过 Multica 已提供的 CLI 或公开接口实现，具体方式在开发时以可验证的官方能力为准。

## 3. 发布内容

发布包包含：

- Agent 名称、描述和能力摘要。
- 不可变 Version ID 与来源信息。
- Runtime 要求和组件清单。
- Prompt、Skills、MCP 和工具的可发布部分。
- 不含密钥的环境变量声明。
- 返回 Studio Version 的溯源标识。

本地绝对路径、Keychain 内容、实验原始数据和未选择发布的日志不得进入发布包。

## 4. 身份映射

Studio 保存本地 Agent ID 与 Multica Agent ID 的映射。首次发布创建远端 Agent，后续发布更新可发布配置或建立新版本，具体策略取决于 Multica 能力。

远端修改不得静默覆盖本地版本。若未来支持双向同步，必须提供差异预览和明确冲突处理。

## 5. 失败处理

- 凭证缺失：引导用户连接，不改变本地 Agent 状态。
- 预检失败：显示字段级原因，不发起部分发布。
- 网络或远端失败：保留可重试 Receipt，不重复创建资源。
- 能力不受支持：显示降级内容，要求用户确认后才能继续。

## 6. 后续决策点

开发 Connector 时，如 Multica 的认证、CLI 稳定性或版本能力与假设不同，需要先向产品负责人确认，不能自行引入共享服务器或直接修改 Multica。

## 7. M5 已实现边界

M5 先建立不依赖真实账号的 Connector 纵向切片：

- 产品领域层只依赖 `AgentPublisher`，不引用 Multica 内部类型。`validate`、`publish` 和 `inspect` 由 Adapter 实现。
- 发布只接受已有成功本地 Run 的不可变 Agent Version。当前 Stack 修订与版本不一致时，预检直接阻断。
- 发布包包含 Agent 元数据、Studio 溯源、组件/能力 Owner、环境声明与 Runtime 要求。本地绝对路径、Keychain 密钥、实验原始数据、Run 日志和 Artifact 被结构化排除。
- SQLite v6 保存本地 Agent ID 与目标 Agent ID 映射、每次尝试的 Receipt、发布包哈希和幂等键。成功记录会被复用；失败记录保留并可以用相同幂等键重试。
- 中文发布面板展示目标、包含/排除内容、预检结果、确认复选框、Receipt 和身份映射。未经明确确认不能发布。

`MulticaContractTestPublisher` 只保留为自动化测试依赖，不再出现在普通 GUI 目标。真实产品目标由 ADR 0013 的官方 CLI Connector 提供；没有 CLI、登录或匹配 Runtime 时返回字段级阻断，不生成成功 Receipt。

## 8. M34 真实发布收束

M34 必须以 Multica 当时可验证的官方认证与发布能力替换 Contract Test 目标。GUI 与 `studio publish validate|publish|status` 从同一冻结 `.agent-stack` Version 物化相同 payload、规范 JSON SHA-256 和幂等键；首次创建与重试不能产生重复远端 Agent。

Connector 只接收已经过发布边界 Schema 的值，不得自行遍历项目目录、SQLite、聊天、Run 日志、Artifact 或 Keychain。真实 API/CLI、认证字段或版本语义与本文假设不同，需要先记录精确差异并请求产品决策；在凭证或官方接口不可用时，预检可以完成但发布必须保持阻断，不能复用本地 Contract Test Receipt 冒充远端成功。

M34 已核验 Multica v0.4.32 的 `version/runtime list/agent list|get|create|update` JSON 契约。Studio 复用 `multica login` 的官方认证，首次发布选择在线且 provider 与 Harness 一致的 Runtime。官方没有 Agent Version 或 create 幂等键，因此 Studio 将 Version ID/hash 标记编译到 instructions，通过 SQLite 映射、create 前 hash 查找、名称冲突后二次查找和映射失效拒绝自动创建实现可恢复幂等。远端 `status` 必须重新执行 `agent get` 比较标记。

Native Harness 发布包声明 `nativeHost: true` 和 `network: runtime-managed`，不携带 Cordis 版本要求；只有旧 Studio Runtime 兼容包保留 Cordis 要求。
