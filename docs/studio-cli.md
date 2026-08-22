# Studio CLI 契约

开发构建通过 `npm run build:cli` 生成 `dist/cli/studio.mjs`。打包应用中的可执行路径显示在次级“项目设置”页；Studio 不修改 PATH、Shell profile 或任何用户配置。

需要把 CLI 中的项目交给 GUI 时，可在启动打包应用时显式传入同一路径：

```bash
"/Applications/Agent Stack Studio.app/Contents/MacOS/Agent Stack Studio" --project /path/to/project
```

`--project` 只接受一个本地项目目录或 `.agent-stack` 路径；缺少值或重复指定会在 Main 启动边界拒绝。GUI 与 CLI 仍共用 Studio Core、revision 和原子写入契约。

```bash
studio project init|inspect|validate|audit
studio component inspect|import|update|archive|delete
studio stack add|remove|owner set|validate|freeze
studio version create|list|inspect
studio workflow create|list|inspect|node-add|node-remove|edge-add|edge-remove|freeze
studio source search|inspect|handoff
studio secret set|status|delete
```

通用参数：

- `--project <path>`：项目根目录或 `.agent-stack` 文件，默认当前目录。
- `--json`：只输出稳定 JSON envelope。
- `--non-interactive`：显式声明机器调用；当前所有命令本来就不提示输入。
- `--revision <n>`：写入时要求磁盘 revision 精确匹配。
- `--provider github`：来源 Provider；M8 仅支持 GitHub 公开仓库。
- `source search` 支持 `--sort relevance|stars|forks|updated`、`--order asc|desc`、`--page 1..10` 与 `--limit 1..50`。
- `source handoff` 支持 `--destination <path>`，只生成命令参数，不执行命令。
- 打包 CLI 使用 Node 的环境代理支持，读取标准 `HTTP_PROXY`、`HTTPS_PROXY` 与 `NO_PROXY`；不会修改这些变量或系统代理。
- `secret set <account> --stdin`：只从标准输入读取密钥；`--service` 默认 `studio.agentstack.desktop`，可用 `--label` 设置钥匙串显示名称。
- `secret status|delete <account>`：只返回状态，不读取或输出密钥。删除不存在的条目为幂等成功。

成功 envelope 为 `{ ok: true, command, data, suggestedActions }`；失败为 `{ ok: false, error: { code, message, details }, suggestedActions }`。稳定进程退出码：usage 2、project not found 3、already exists 4、invalid 5、migration 6、revision conflict 7、component not found 8、in use 9、component invalid 10、stack invalid 11、version not found 12、unsafe source 13、I/O 14、discovery query 15、network 16、rate limit 17、provider 18、provider unavailable 19、source not found 20、project integrity 21、Keychain failed 22、Keychain unavailable 23、cancelled 130、unexpected 70。

重复 import、Stack add/remove、Owner set 和相同内容 freeze 均幂等。Workflow 写命令同样接受 `--revision`。`workflow create` 使用 `--name`/`--description`；`node-add` 使用 `--kind operation|component|agent-version|workflow-version`、`--name` 和 `--ref`，子 Workflow Version 另需 `--target-workflow`。`edge-add` 在任何写入前拒绝自环和可达回边，稳定错误码为 `WORKFLOW_CYCLE`；相同 Workflow 内容重复 `freeze` 会复用不可变 Version。

`project validate` 和 `stack validate` 的 `data.validation.remediationTasks` 会为未验证 Adapter/Fork 返回确定性的工作产物、契约测试与最小运行验证链；只有 `status: required` 的步骤会追加到 envelope 的 `suggestedActions`。这些任务是 Descriptor 的派生结果，不写入项目，也不会执行 Adapter 引用或测试命令。

`source search` 只调用公开 GET API；`source handoff` 返回必须审阅的 `git clone` 与 `studio component inspect` 参数数组。CLI 不执行这两个命令；Coding Agent 或人工 Shell 负责下载和后续工程命令。

`project audit` 是非交互、只读检查：它不会从备份自动恢复，也不会改写 revision。成功结果包含 `algorithm`、`versionsChecked` 和逐版本的 `contentHash`/`snapshotHash`；不一致返回 `PROJECT_INTEGRITY_FAILED`（退出码 21）及结构化修复建议。普通 `project inspect` 仍可按项目存储契约恢复最后有效备份。

M30 之后，CLI 的 `component`、`stack`、`owner`、`workflow` 和 `version` 项目命令与 GUI Agent 组装器共享同一 `.agent-stack` 事实和 Studio Core 验证逻辑。GUI 导入后 CLI 立即可见，CLI 写入后 GUI 通过外部修改通知刷新；revision 不匹配仍返回稳定冲突错误。CLI 不读写 SQLite Component/Stack 副本，也不执行未受信外部代码。

M31 增加以下生命周期与验证命令：

- `component list --scope active|archived|all`：默认 active，可显式查看已归档组件。
- `component restore <component-id> --revision <n>`：恢复可选状态并记录审计；重复恢复幂等。
- `component contract-test <component-id> --revision <n>`：运行确定性 Descriptor/Adapter Contract 检查，不 import 组件项目代码；通过后写入 Receipt 和 Artifact 哈希。
- `component runtime-validate <component-id> --timeout-ms <n> --revision <n>`：仅对精确白名单 Adapter 启动全新受信 Runtime；`SIGINT`/`SIGTERM` 取消且零证据写入，超时或异常使用稳定错误 envelope。

`component update` 仍接受结构化 Descriptor 文件，但 Core 会忽略其中伪造的 validation/evidence；改变技术契约会回退当前验证并保留 superseded 历史。永久 `component delete` 要求先归档，然后仍执行 Stack/Workflow/Version 引用保护。
