# 实验与可复现性

## 1. 目标

实验模块用于回答：在 A、B、C、D、E 保持一致时，只改变 F、G，结果是否发生了稳定且可解释的变化。

Studio 不仅保存用户在表单里选择的变量，还需要检测运行时实际发生的变化。

## 2. 三层模型

### Agent Version

完整、不可变的 Stack 快照，包含组件 Owner、版本、配置引用、Workflow、Prompt、模型和 Adapter。

### Experiment

定义研究问题、基准 Agent Version、控制变量、实验变量、数据集、重复次数和评价方法。

### Run

实验矩阵中的一次具体执行。Run 绑定完整 Manifest，保存状态、事件、产物和指标。

## 3. Run Manifest

每次 Run 至少记录：

- Agent Version ID 与 Stack 哈希。
- 所有组件、Adapter 和 Connector 的版本及内容哈希。
- Prompt、模型名称、模型参数和工具定义。
- Workflow Version 或 Agent Loop 配置。
- 环境变量名称及脱敏值哈希，不记录密钥原文。
- macOS、CPU 架构、Node.js、Electron 和 Cordis 版本。
- 代码 commit、工作区 dirty 状态和依赖 lockfile 哈希。
- 数据集版本、样本选择规则和输入哈希。
- 随机种子、时间、重试策略和并发设置。
- 权限、网络策略和沙箱配置。

模型服务本身可能不保证确定性。Studio 应把“配置可复现”和“输出完全确定”分开表达。

## 4. 控制变量锁定

锁定不是禁止用户修改本地草稿，而是保证某个 Experiment 引用的快照不会被修改。

运行前执行 Drift Check：

1. 比较当前工作区与基准 Manifest。
2. 把变化分为预期变量、允许的运行元数据和非预期漂移。
3. 出现非预期漂移时默认阻止运行。
4. 用户可以另存为新的 Experiment Version，不能覆盖已有实验记录。

## 5. 实验矩阵

F 有两个候选实现、G 有三个参数组合时，系统生成六个实验单元。每个单元可以配置重复次数和种子集合。

界面需要同时显示：

- 变量组合。
- 运行状态和失败原因。
- 主要评价指标。
- 相对基准的变化。
- 是否存在非预期 Drift。
- 运行成本和耗时。

## 6. 结果比较

第一版支持表格比较、筛选和导出，不强制提供复杂统计结论。评价器输出需要包含值、方向、置信说明和原始证据链接。

任何人工评分都要记录评分人、评分规则版本和时间。LLM-as-a-Judge 必须记录 Judge 模型、Prompt 和参数。

## 7. 冷启动原则

科研 Run 默认在新的 Runtime 子进程中启动，运行结束后销毁。Cordis 热替换可以用于开发预览，但不能作为正式对照实验的默认执行方式。

## 8. M3 已实现边界

M3 先用内置 Agent Loop 样例验证完整本地闭环：

- Run 只引用最新的不可变 Agent Version；Stack 草稿的修订、组件身份或版本发生变化时，要求先创建新版本。
- Main 为每次 Run 启动一个全新 Runtime 子进程，只传入经 Zod 校验的 Manifest；子进程环境不继承任意应用环境变量。
- Manifest 固化 Runtime Plan、组件 Descriptor 哈希、平台与 Cordis 版本、随机种子、超时、权限边界和内容哈希，不包含密钥原文。
- SQLite 保存 Run 状态和有序事件；成功输出写入本地 Artifact 目录，并记录内容哈希与大小。
- 取消使用协作式 Abort，超时先请求清理、随后强制终止；进程异常、取消和超时映射为不同终态。
- Agent Loop、Workflow、Hybrid、External Harness 都有明确执行描述，但 M3 只允许内置、已授信的 Agent Loop Adapter 执行。其他模式在绑定不可变的受信实现前由预检阻断。

这一步验证“配置与执行记录可复现”，不声称模型输出完全确定。实验矩阵、Drift Check 和结果比较由 M4 接续实现。

## 9. M4 已实现边界

M4 用内置 Agent Loop 样例建立可验证的本地对照实验：

- 实验创建时固化不可变 Agent Version、Stack 修订与 Runtime Plan 哈希、Component Descriptor 哈希、执行模式、Runtime 环境、权限边界和内置数据集七类控制变量。
- F 变量是 Prompt 候选，G 变量是随机种子；系统按 `Prompt × Seed × Repetition` 展开实验单元，并串行执行每个冷启动 Run。
- 启动前重新计算 Drift。任一非实验变量发生变化都会显式标记原值与当前值，并默认阻止矩阵执行。
- 每个实验单元关联完整 Run 记录；矩阵支持失败隔离、整体取消和应用退出时的顺序清理。
- 结果表提供成功率、平均耗时及相对第一个基准组合的耗时变化。这些是描述性基础指标，不代表统计显著性或模型输出完全确定。
- 导出通过 Main 进程原生保存对话框选择路径，Renderer 不获得文件系统权限。JSON 保留完整定义和证据，CSV 面向表格分析并防止公式注入。

当前评价器仅有 `runtime-duration-v1`，数据集仅有内置样例，且不执行未知第三方组件。外部数据集、LLM-as-a-Judge、人工评分和高级统计分析留给后续里程碑。

## 10. M12 四模式本地执行

- Agent Loop、Workflow、Hybrid 与 External Harness 都可以使用版本固定的 Studio 内置 Profile 进入 Run 和实验矩阵。
- Workflow Version、入口节点、Hybrid handoff、Controller 或 Harness Component 进入每个 Run Manifest；执行模式及 Runtime Plan 哈希继续参与 Drift Check。
- 四种模式使用相同冷启动、取消、超时、Artifact 和事件契约。内置步骤是确定性的边界验证，不代表模型输出或第三方 Harness 行为。
- Runtime 只接受精确白名单 Adapter。导入仓库即使具有 Runtime Adapter 声明，也继续停留在静态证据阶段，不能被实验执行。

## 11. M23 历史 Run 与 Drift

- 每条 Run 详情把不可变 Manifest 中的 Prompt、随机种子、超时、重试/并发与实际总耗时组合为只读历史投影。
- 若 Run 属于实验单元，历史 Drift 使用 Run Manifest 对照实验创建时锁定的控制变量重新计算；不读取后来变化的 Agent 草稿或 Stack。
- F/G 变量本身来自实验单元与 Run Manifest，不被误判为控制变量 Drift。页面同时标出 Prompt 变量序号和重复次数。
- 独立 Run 没有实验定义作为基准，必须表达为“不适用”，不能把“没有检查”显示为 clean。

## 12. M24 部分结果与矩阵观测

- 页面把 `succeeded`、`failed`、`cancelled` 与 `blocked` 都计入终态，但只把 `succeeded` 计入成功；终态成功率以所有终态单元为分母。
- 成功平均耗时只使用具有有效耗时的成功单元。失败、取消和 Drift 阻断不会被零值稀释，也不会生成虚假的相对基线。
- “需关注”筛选包含失败、取消与 Drift 阻断；文本筛选覆盖 Prompt、seed、Run ID 和失败原因，使局部故障可从大矩阵中定位。
- 实验定义、评价器、超时、时间范围和完整计划分母与筛选结果同屏，筛选不会改变不可变定义或已保存单元。
- packaged 验证用真实四单元实验在首个成功后取消，保留一项成功和三项取消，再验证 4/4 终态、1/3 成功/需关注、25% 成功率、失败原因筛选及基础对比。
