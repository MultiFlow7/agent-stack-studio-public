# ADR 0002：从第一阶段采用 Cordis 作为运行内核

- 状态：已接受
- 日期：2026-08-19

## 背景

产品长期目标包括动态组合、替换和验证 Agent Stack。若第一阶段完全绕开 Cordis，后续可能需要替换依赖注入和生命周期机制。另一方面，直接把 Cordis 类型暴露给全部产品模型和第三方组件，会增加耦合并放大其 API 稳定性风险。

## 决策

从第一阶段使用 Cordis，范围限于 Runtime 子进程中的 Service、依赖注入、生命周期和运行时组合。

Studio 自己定义 Agent、Component、Stack、Experiment 和 Run 等领域模型，并将已验证 Stack 编译为 Cordis Runtime Plan。第三方组件通过 Studio Adapter Contract 接入，Cordis 类型不穿透到产品领域层。

## 这是否重新实现 Cordis

不是。Studio 的领域模型不提供通用 Service 容器、注入、Fiber 或生命周期调度。它负责用户可理解的结构、版本、冲突和实验。运行机制仍由 Cordis 提供。

## 风险与约束

- 锁定 Cordis 版本或 commit。
- 用契约测试验证初始化、销毁、取消和错误恢复。
- 正式实验使用冷启动进程，不依赖热替换复现。
- Cordis 不提供安全沙箱，未知代码必须使用额外进程边界。
- 外部副作用不能假设随 Service 销毁自动回滚。
