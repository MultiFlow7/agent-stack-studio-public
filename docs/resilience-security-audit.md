# M29 稳定性与敏感信息审计

## 范围

M29 对本地产品的空值、重复请求、并发、权限、超时、异常处理和敏感信息边界进行定向复核。它不改变 SQLite v8、`.agent-stack` v2、Agent Stack Package v2、Runtime Plan、Runtime IPC、Studio CLI 项目协议或已冻结的本地/分发需求矩阵。

## 已关闭风险

| 类别 | 处置 | 自动化证据 |
| --- | --- | --- |
| 空值与输入 | 备份清单、恢复标记、Descriptor 引用、GitHub URL 与 Runtime 消息保持严格、限长且拒绝凭证 | shared schema、maintenance、Runtime tests |
| 重复请求 | Preload 合并同一只读请求并在写操作前后失效；发布预检/提交、维护、Keychain 提示和发现请求使用单航班 | Publish、Discovery、Secret、Maintenance tests；packaged E2E |
| 并发 | 项目迁移/恢复进入写锁；只回收已死亡 PID 的过期锁；文件监听和 Renderer 只接受最新响应；重复取消幂等 | ProjectStore、Run、Renderer tests |
| 权限 | 应用 umask 为 `077`；日志、工作区、Artifact、备份、恢复和导出文件为 `0700/0600` | Logger、Maintenance、packaged package verification |
| 超时 | GitHub、发布 Adapter、Keychain、osascript、Runtime 取消与退出均有有界等待和强制清理 | Adapter、Publish、Runtime tests |
| 异常 | 子进程 IPC/退出、日志失败、文件监听、启动/退出、导入回滚和重复恢复均保持受控失败 | Runtime、Agent、Import、Main/package E2E |
| 敏感信息 | 日志/CLI/IPC/Runtime 统一净化；Runtime stdout/stderr 不记录正文；Git remote、URL 凭证和敏感查询参数不进入项目事实 | Sensitive-data、Logger、Component、Source tests；公开快照隐私门禁 |

## 保持的边界

- Renderer 仍无 Node、文件系统、数据库或密钥访问；所有 IPC 继续执行输入/输出 Schema 校验，并只接受主 Renderer frame。
- 密钥原文只经安全输入进入 macOS Keychain；数据库、项目文件、Artifact、Receipt 和日志只保存引用或净化后的诊断。
- Cordis 仍只在独立 Runtime 子进程；未知第三方代码仍不执行。
- 真实 Multica Transport 仍保持外部阻断；本地 contract-test target 只验证发布协议和幂等语义。

## 验收

完成时必须通过 `npm run check`、CLI/macOS 打包、包验证和 packaged E2E；最终包需重新启动并实际运行包内 CLI。公开分支仍以 `npm run verify:public-snapshot` 作为推送前隐私门禁。
