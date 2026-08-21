# ADR 0004：GitHub 公开来源发现与下载交接

- 状态：已接受
- 日期：2026-08-20

## 背景

M7 只接收已经存在于本机的组件目录。M8 需要帮助用户与 Coding Agent 找到公开候选仓库，但不能让 Studio 执行未知第三方代码，也不能把 GitHub 固化为项目领域模型或 `.agent-stack` 的事实来源。

GitHub REST API 的公开仓库查询支持无认证读取，但公开请求和搜索端点受频率限制。GitHub 要求调用方读取 rate-limit 响应头，在 `403` 或 `429` 后停止重试，并建议避免并发请求和使用条件请求。参考：[Search API](https://docs.github.com/en/rest/search/search)、[Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)。

## 决策

1. Core 定义厂商无关的 `SourceDiscoveryProvider`、候选来源和下载交接格式。GitHub REST 实现位于外层 Adapter；`.agent-stack` 不增加 GitHub 专用字段。
2. M8 仅在用户或 CLI 主动提交搜索、检查或交接命令后访问固定的 `https://api.github.com` 公开 GET 端点。请求不携带项目文件、项目路径、组件清单、设备标识或凭证。
3. M8 不接收或保存 GitHub Token，不访问私有仓库。认证、私有来源和 GitHub Enterprise 留给后续单独决策。
4. 搜索读取 GitHub 报告的仓库名称、描述、URL、默认分支、许可证、语言、topics、Star、Fork、归档状态和更新时间。界面标记为 `provider-reported`，不把它表述为 Studio 验证结果。
5. Provider 串行请求，使用固定 REST API 版本头、15 秒超时和 ETag 条件请求。它读取 rate-limit 响应头，不对 `403`、`429` 或网络失败自动重试。
6. `source handoff` 只生成结构化、必须审阅的 `git clone` 与 `studio component inspect` 参数数组。Studio 不执行、不排队、不后台下载这些命令。
7. GUI 提供取消、空、无结果、网络失败、频率限制和成功状态。复制与打开 URL 通过经 schema 校验的 IPC 白名单完成；只允许打开 HTTPS GitHub URL。
8. 搜索结果与查询只保存在当前进程内存，不写入 `.agent-stack` 或 SQLite。只有用户完成本地下载并主动导入后，M7 的静态来源证据才进入项目状态。

## 结果

Studio 可以把公开来源发现交给 GUI、人工 Shell 或任意 Coding Agent，同时保持本地项目事实、下载动作和第三方执行权限彼此分离。代价是无认证公开搜索额度较低，私有仓库和企业实例暂不支持；遇到限制时必须等待重置或改用 GitHub 网站完成调研。
