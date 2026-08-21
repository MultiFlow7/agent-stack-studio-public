# ADR 0008：四种本地可信执行 Profile

- 状态：已接受
- 日期：2026-08-20

## 背景

M3 为 Agent Loop 建立了独立 Runtime 子进程、取消、超时和 Artifact 闭环，但 Workflow、Hybrid 与 External Harness 仍只有结构化描述。用户可以选择这些模式，却无法在本机完成 Run 或 Experiment。与此同时，直接加载导入仓库的 Runtime Adapter 会违反“默认不执行未知第三方代码”的硬边界。

## 决策

1. 四种执行模式都绑定 Studio 自带、版本固定的本地可信 Profile。Workflow 使用内置线性 DAG；Hybrid 先执行内置 Workflow 准备节点，再显式把控制权交给 Agent Loop；External Harness 只验证内置 Harness X 的边界契约。
2. Runtime Adapter 使用精确引用白名单，不把 `studio://runtime/` 前缀本身视为信任。新增白名单项必须修改代码并增加 Manifest、Runtime、取消与失败测试。
3. Agent Loop、Hybrid 与 External Harness 必须有 `execution-controller`。External Harness 还必须把控制器绑定到已通过最小运行验证的内置 Harness X Adapter。
4. Workflow Version ID、入口节点、Hybrid handoff、Controller Service Key 或 Harness Component ID 写入不可变 Run Manifest，并参与 Manifest 内容哈希。
5. 所有模式继续使用全新 Cordis Runtime 子进程，保持网络禁止、文件系统仅 Artifact、单 Run 单并发、零重试和超时清理。
6. 导入的本地仓库、Manifest 中的 Runtime Adapter、Shell、二进制、Hook、Makefile 或依赖安装仍不执行。静态 `user-confirmed` 不能自动升级为可信执行。
7. Agent 能力页从同一 Stack 编译状态读取 Provider、Owner、验证证据与阻断项，不在 Renderer 复制编译逻辑。

## 结果

用户可以在本机对 Agent Loop、Workflow、Hybrid 和 External Harness 四种模式运行同一套可信样例与实验矩阵，并看到不可变执行绑定。这里的 External Harness 是 Studio 内置契约实现，不代表任意导入 Harness 已获得执行许可。真实第三方运行接入仍需要独立 Adapter、契约测试、最小运行验证和新的安全决策。
