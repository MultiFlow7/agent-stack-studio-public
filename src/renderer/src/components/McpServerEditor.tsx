import { CheckCircle, Plus, Trash, WarningCircle } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import type { McpServer } from '../../../shared/agent-profile'
import { mcpTransportSupport, type McpValidationRecord } from '../../../shared/mcp'
import type { HarnessId } from '../../../shared/native-agent'

interface McpServerEditorProps {
  servers: McpServer[]
  harnessId: HarnessId | null
  validations?: McpValidationRecord[]
  disabled?: boolean
  onChange: (servers: McpServer[]) => void
  onValidate?: (serverId: string) => void
}

function nextServerId(servers: McpServer[]): string {
  let index = servers.length + 1
  while (servers.some(({ id }) => id === `mcp-server-${index}`)) index += 1
  return `mcp-server-${index}`
}

function emptyServer(servers: McpServer[]): McpServer {
  return {
    id: nextServerId(servers),
    name: '新 MCP server',
    transport: 'http',
    command: null,
    args: [],
    url: 'https://',
    secretReferences: [],
    enabled: true,
    approval: 'review-required',
  }
}

export function McpServerEditor({
  servers,
  harnessId,
  validations = [],
  disabled = false,
  onChange,
  onValidate,
}: McpServerEditorProps) {
  const [expandedId, setExpandedId] = useState<string>()
  const validationByServer = useMemo(
    () => new Map(validations.map((validation) => [validation.serverId, validation])),
    [validations],
  )

  function update(serverId: string, values: Partial<McpServer>): void {
    onChange(servers.map((server) => (server.id === serverId ? { ...server, ...values } : server)))
  }

  function add(): void {
    const server = emptyServer(servers)
    onChange([...servers, server])
    setExpandedId(server.id)
  }

  return (
    <section className="mcp-editor" aria-labelledby="mcp-editor-heading">
      <div className="agent-builder__section-heading mcp-editor__heading">
        <div>
          <h3 id="mcp-editor-heading">MCP servers</h3>
          <p>
            远程 HTTP 与本地 stdio 分开配置。只有你明确批准并通过连接验证的 server 才能参与运行。
          </p>
        </div>
        <button
          className="button button--secondary"
          disabled={disabled}
          onClick={add}
          type="button"
        >
          <Plus aria-hidden="true" size={16} />
          添加 MCP server
        </button>
      </div>

      {servers.length ? (
        <ul className="mcp-editor__list">
          {servers.map((server) => {
            const validation = validationByServer.get(server.id)
            const exactValidation =
              validation && JSON.stringify(validation.server) === JSON.stringify(server)
                ? validation
                : undefined
            const support = harnessId ? mcpTransportSupport(harnessId, server.transport) : null
            const expanded = expandedId === server.id
            return (
              <li key={server.id}>
                <div className="mcp-editor__summary">
                  <button
                    aria-expanded={expanded}
                    className="mcp-editor__disclosure"
                    onClick={() => setExpandedId(expanded ? undefined : server.id)}
                    type="button"
                  >
                    <span>
                      <strong>{server.name}</strong>
                      <small>
                        {server.transport === 'stdio' ? '本地 stdio' : '远程 HTTP'} ·{' '}
                        {server.approval === 'approved' ? '已批准' : '待审查'}
                      </small>
                    </span>
                  </button>
                  {exactValidation?.state === 'succeeded' ? (
                    <span className="status-label status-label--support-native">
                      <CheckCircle aria-hidden="true" size={14} weight="fill" />
                      已验证 {exactValidation.toolNames.length} 个工具
                    </span>
                  ) : exactValidation?.state === 'failed' ? (
                    <span className="status-label status-label--support-unavailable">
                      <WarningCircle aria-hidden="true" size={14} />
                      验证失败
                    </span>
                  ) : (
                    <span className="status-label">未验证</span>
                  )}
                  <button
                    aria-label={`移除 MCP ${server.name}`}
                    className="button button--quiet"
                    disabled={disabled}
                    onClick={() => onChange(servers.filter(({ id }) => id !== server.id))}
                    type="button"
                  >
                    <Trash aria-hidden="true" size={15} />
                    移除
                  </button>
                </div>

                {expanded ? (
                  <div className="mcp-editor__body">
                    <div
                      className="mcp-editor__transport"
                      role="radiogroup"
                      aria-label="MCP transport"
                    >
                      {(['http', 'stdio'] as const).map((transport) => (
                        <label key={transport}>
                          <input
                            checked={server.transport === transport}
                            disabled={disabled}
                            name={`mcp-transport-${server.id}`}
                            onChange={() =>
                              update(server.id, {
                                transport,
                                command: transport === 'stdio' ? '' : null,
                                args: [],
                                url: transport === 'http' ? 'https://' : null,
                                approval: 'review-required',
                              })
                            }
                            type="radio"
                          />
                          <span>
                            <strong>{transport === 'http' ? '远程 HTTP' : '本地 stdio'}</strong>
                            <small>
                              {transport === 'http'
                                ? '连接你明确配置的 Streamable HTTP endpoint。'
                                : '以 shell=false 启动一个已批准的可执行文件与 argv。'}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="native-profile-grid">
                      <label className="field">
                        <span>名称</span>
                        <input
                          disabled={disabled}
                          maxLength={100}
                          onChange={(event) =>
                            update(server.id, {
                              name: event.target.value,
                              approval: 'review-required',
                            })
                          }
                          value={server.name}
                        />
                      </label>
                      <label className="field">
                        <span>配置 ID</span>
                        <input
                          disabled={disabled}
                          maxLength={64}
                          onChange={(event) => {
                            const nextId = event.target.value
                            update(server.id, { id: nextId, approval: 'review-required' })
                            setExpandedId(nextId)
                          }}
                          value={server.id}
                        />
                      </label>
                    </div>
                    {server.transport === 'http' ? (
                      <label className="field">
                        <span>Streamable HTTP URL</span>
                        <input
                          disabled={disabled}
                          onChange={(event) =>
                            update(server.id, {
                              url: event.target.value,
                              approval: 'review-required',
                            })
                          }
                          type="url"
                          value={server.url ?? ''}
                        />
                      </label>
                    ) : (
                      <div className="native-profile-grid">
                        <label className="field">
                          <span>可执行文件</span>
                          <input
                            disabled={disabled}
                            onChange={(event) =>
                              update(server.id, {
                                command: event.target.value,
                                approval: 'review-required',
                              })
                            }
                            value={server.command ?? ''}
                          />
                          <small className="field__help">带路径时必须是绝对路径。</small>
                        </label>
                        <label className="field">
                          <span>参数（每行一个 argv）</span>
                          <textarea
                            disabled={disabled}
                            onChange={(event) =>
                              update(server.id, {
                                args: event.target.value ? event.target.value.split('\n') : [],
                                approval: 'review-required',
                              })
                            }
                            rows={4}
                            spellCheck={false}
                            value={server.args.join('\n')}
                          />
                        </label>
                      </div>
                    )}
                    <div className="mcp-editor__risk">
                      <WarningCircle aria-hidden="true" size={18} />
                      <span>
                        <strong>审查来源与权限</strong>
                        <small>
                          {server.transport === 'stdio'
                            ? '本地 server 会以最小环境运行；Studio 不使用 shell，也不执行未批准配置。'
                            : '远程 server 可以看到工具调用参数；Studio 不跟随重定向。'}
                        </small>
                      </span>
                    </div>
                    {support ? (
                      <p className={`mcp-editor__support mcp-editor__support--${support.level}`}>
                        <strong>{harnessId} 支持：</strong> {support.detail}
                      </p>
                    ) : (
                      <p className="mcp-editor__support">选择 Harness 后显示真实支持状态。</p>
                    )}
                    <label className="mcp-editor__approval">
                      <input
                        checked={server.approval === 'approved'}
                        disabled={disabled}
                        onChange={(event) =>
                          update(server.id, {
                            approval: event.target.checked ? 'approved' : 'review-required',
                          })
                        }
                        type="checkbox"
                      />
                      我已审查并明确批准这个 server 的来源、地址与参数
                    </label>
                    {exactValidation?.failure ? (
                      <div className="detail-feedback detail-feedback--error" role="alert">
                        <strong>{exactValidation.failure.message}</strong>
                        <span>{exactValidation.failure.recoveryAction}</span>
                      </div>
                    ) : null}
                    {exactValidation?.state === 'succeeded' ? (
                      <div className="detail-feedback" role="status">
                        握手成功；发现工具：{exactValidation.toolNames.join('、') || '无'}。
                        {exactValidation.executable
                          ? ` 实际可执行文件：${exactValidation.executable}`
                          : ''}
                      </div>
                    ) : null}
                    {onValidate ? (
                      <button
                        className="button button--secondary"
                        disabled={
                          disabled ||
                          server.approval !== 'approved' ||
                          support?.level === 'unavailable'
                        }
                        onClick={() => onValidate(server.id)}
                        type="button"
                      >
                        测试连接与工具发现
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="agent-builder__catalog-empty" role="status">
          <strong>尚未配置 MCP</strong>
          <span>保持为空不会阻止创建或 Native run。</span>
        </div>
      )}
      <p className="mcp-editor__secret-note">
        Secret 只能通过 Keychain 引用接入；这个编辑器不接收 token、API Key 或环境变量值。
      </p>
    </section>
  )
}
