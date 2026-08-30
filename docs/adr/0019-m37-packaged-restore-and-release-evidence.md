# ADR 0019：M37 以最终应用重启验收备份恢复并分离外部分发阻断

- 状态：已接受，M37 已实施
- 日期：2026-08-23
- 依据：ADR 0007、M37 升级/迁移/备份恢复验收

## 背景

单元测试已覆盖备份哈希、SQLite 完整性、失败回滚和待恢复目录，但还不能证明最终 `.app` 在退出和下次启动边界上真正应用恢复。同时，Developer ID、Apple 公证、Intel runner 分配和真实 Multica/Harness 凭证属于仓库代码无法制造的外部事实，不能用“本地已跳过”代替。

## 决策

1. Packaged E2E 通过 Main-owned 测试选择器使用临时 Application Support 中的固定备份目录。Renderer 仍只发送空输入，不能提交路径；普通打包应用仍使用 macOS 原生选择器。
2. 验收顺序固定为：GUI 创建备份→更改已备份 Artifact→GUI 检查备份→用户确认→退出→再次启动→在 Repository 打开前应用 pending restore。
3. 验收同时证明两份内容：当前 Artifact 回到备份值，Recovery 自动回滚备份保留恢复前的改写值。设置页必须显示真实“最近恢复”时间。
4. `STUDIO_PACKAGED_E2E=1` 下不由 App 自动 relaunch，由测试宿主在旧进程完全退出后重新启动同一最终可执行文件，以便确定性跟踪和清理进程。生产路径仍使用 `app.relaunch()`。
5. 分发报告必须把代码可验证项和外部条件分开。当前 HEAD `ff6dd50` 的 GitHub Actions run `32624691417` / job `97158079034` 在 `runner_id: 0`、0 steps 状态下失败，check-run annotation 明确说明账户近期付款失败或支出上限不足。它表示 job 没有启动，不得记为 Intel 测试失败或成功；恢复账户 Billing 后必须从当前 HEAD 重跑。

## 后果

备份恢复现在有最终 arm64 App 的跨进程证据，不再只依赖 Service 测试。代价是 packaged E2E 多一次受控重启，且 Intel CI、签名/公证和真实远端证据仍必须等待外部条件，不会被本 ADR 降级为可选。
