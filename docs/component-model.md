# 组件能力模型

## 1. 为什么需要独立模型

Cordis 解决运行时服务组合，不负责表达研究者看到的模块边界。Studio 的组件能力模型是一份产品层清单，用来说明某项能力由谁提供、能否替换、依赖什么以及证据来自哪里。

它不会实现 Service 容器、注入算法或生命周期调度，因此不等于重做 Cordis。

## 2. 能力分类

第一版采用可扩展的能力分类，不把分类写死为固定的 A 至 G：

- `execution-controller`：Agent Loop、Workflow 或外部 Harness 控制器。
- `model-provider`：模型选择、调用和参数。
- `prompt-policy`：System Prompt、模板和策略。
- `context-builder`：上下文选择、裁剪和组装。
- `memory`：短期、长期、向量或结构化记忆。
- `tool-runtime`：工具注册、调用和返回处理。
- `skill-provider`：Skills 发现、加载和约束。
- `mcp-client`：MCP Server 连接和能力映射。
- `state-store`：会话与任务状态持久化。
- `sandbox`：命令、文件和网络执行边界。
- `trace`：事件、日志和调用链。
- `evaluator`：评分、比较和回归判断。
- `human-gate`：审批、暂停和人工输入。

分类允许增加扩展项，但新增分类需要命名空间，避免与核心分类发生冲突。

## 3. Component Descriptor

```yaml
id: org.example.pi-harness
name: Pi Harness
version: 1.2.3
source:
  kind: local-package
  location: /path/to/package
  license: MIT
platforms: [darwin-arm64, darwin-x64]
provides:
  - capability: execution-controller
    implementation: pi.loop
    replaceability: adapter-required
    confidence: declared
  - capability: tool-runtime
    implementation: pi.tools
    replaceability: configurable
requires:
  - capability: model-provider
    version: ">=1"
configSchema: ./schemas/config.json
runtimeAdapter: ./dist/adapter.js
```

Descriptor 是声明和证据，不是可执行权限。导入时先解析 Descriptor，再决定是否允许加载 Runtime Adapter。

## 4. 覆盖和可替换状态

| 状态 | 含义 |
| --- | --- |
| 内置 | Harness 自身实现并默认启用 |
| 可配置 | 可以通过配置切换实现，不需要改代码 |
| 可禁用 | 能关闭，且关闭后依赖关系可满足 |
| 可替换 | 存在已验证的稳定接口 |
| 需要 Adapter | 接口不同，但可通过适配层连接 |
| 需要 Fork | 必须修改上游或维护补丁 |
| 锁定 | 当前实现不可独立替换 |
| 未知 | 扫描证据不足，需要用户确认或验证 |

## 5. 能力 Owner

一个能力槽位在一个 Agent Version 中只能有一个 Active Owner。其他实现可以作为候选或依赖存在，但不能静默同时接管相同能力。

重叠处理过程：

1. 收集所有 Provider。
2. 读取显式优先级，但不自动替用户做最终取舍。
3. 展示每个候选的来源、依赖、替换成本和证据。
4. 用户选择 Owner。
5. 编译器检查未被选择的实现是否仍会产生副作用。
6. 生成 Runtime Plan 和验证任务。

如果两个实现必须共同工作，应将它们表达为不同子能力或一个显式组合组件，不能通过隐式双 Owner 绕过规则。

## 6. 兼容性等级

- Native：接口、数据和生命周期直接兼容。
- Configuration：只需配置映射。
- Adapter：需要可测试的转换代码。
- Fork：需要修改第三方项目。
- Blocked：平台、许可、安全或语义上无法组合。
- Unknown：缺少证据。

Vibe coding 可以生成 Adapter 和测试，但系统不能把“代码已生成”等同于“已经兼容”。兼容状态只有在契约测试和最小运行验证通过后才能升级。

Adapter 本身是有版本的组件，也必须进入实验快照。更换 Adapter 不属于控制变量保持不变。

## 7. M2 实现边界

M2 使用 Component Contract v1 保存不可变的 Descriptor 版本，并在 SQLite 中分开记录 Stack 组件关联与 capability owner。Runtime Plan 编译器位于 Main 的领域边界，输出只包含稳定的 Studio 服务描述和 Cordis 锁定版本，不暴露 Cordis 类型。

编译器会阻断以下状态：

- Stack 为空。
- 重叠能力没有显式 Owner，或 Owner 不是当前 Provider。
- 组件依赖的能力没有 Provider。
- 组件已阻断、兼容性未知，或 Adapter/Fork 尚未通过最小运行验证。
- 未被选为 Owner 的实现仍会激活同一能力的副作用。

## 8. 与开源组件的边界

“不冲突”不能保证所有第三方项目天然兼容。Studio 能保证的是冲突不会被隐藏：

- 保留组件来源、版本、许可证和修改状态。
- 默认使用 Adapter，不直接修改上游代码。
- 必须 Fork 时建立独立组件版本并记录补丁。
- 不把第三方私有类型扩散到领域模型。
- 不声称自动生成的适配器继承了上游兼容性保证。

许可兼容与运行兼容是两项独立检查。第一版展示许可证和来源，但不替代法律判断。

## 9. M7 静态证据等级

项目文件对组件识别结论使用五级证据：`declared`、`detected`、`user-confirmed`、`contract-tested`、`runtime-verified`。安全静态导入最多产生 declared 或 detected；编辑 Descriptor 只修正结构化事实，必须保留原证据等级。`user-confirmed` 只能由用户对信任、许可、Owner 或业务接受的显式决策产生并留存审计。只有真实契约测试和受信最小运行验证才能继续提升，不能由文案或文件名推断。

Component 的可移植定义由 `.agent-stack` 保存。SQLite 只保留本机项目索引；历史 Version 引用会阻止永久删除，允许归档并保持旧快照可读。

## 10. M20 目录与详情投影

全局目录中的“使用方”不是 Component Descriptor 字段。Studio 从当前 Agent Stack 草稿读取当前使用方，并从不可变 Agent Version 快照读取历史受影响版本；两者必须分别表达，不能用当前草稿覆盖历史。

验证记录时间复用 Component 本机记录的 `updatedAt`，仅表示当前非 declared 验证结论何时被记录。它不证明测试在该时间重新执行，也不替代 Evidence 详情。declared 组件显示“尚无验证记录”。

详情中的 source、configSchema 和 runtimeAdapter 都是 Descriptor 引用。Renderer 只显示字符串，不读取本机文件或远程内容；Runtime 是否允许加载仍由 M12 精确白名单决定。

## 11. M22 结构化处置链

需要 Adapter/Fork 且未通过最小运行验证时，Studio 根据 Descriptor 派生三段处置链：工作产物、契约测试、最小运行验证。每段包含确定 ID、状态和验收条件；`contract-tested` 只证明前两段已有证据，不能把 Runtime Plan 标为就绪。

处置链不是任务管理后台，也不保存生成代码。它不进入 Component Descriptor、项目文件、SQLite 或 Version；重新验证当前事实即可重建。任何实际生成、修复或执行 Adapter/Fork 都仍需用户在明确受信工作区完成。

## 12. M30 兼容性评估

Studio Core 对当前 Stack 的每个 Component 输出 `CompatibilityAssessment`：用户状态为未检查、静态通过、需配置、需 Adapter、运行验证通过或不兼容。结论带稳定证据、阻断原因、`suggestedActions`、验证时间和验证方法；GUI 与 CLI 必须显示同一 Core 结果。

项目的 `components`、`stack`、`owners`、`workflows` 和 `versions` 都只在 `.agent-stack` 中读写。SQLite 中的历史 Component/Stack/Owner/Version 只作一次性迁移输入；迁移完成后本机 Agent 只保留对项目和不可变项目 Version 的稳定引用。
