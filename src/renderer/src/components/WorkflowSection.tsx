import { ArrowRight, GitBranch, Plus, Snowflake, Trash } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import type { StudioProject, WorkflowNode } from '../../../core/project-model'
import type { StudioProjectState } from '../../../shared/studio-project'

interface WorkflowSectionProps {
  project: StudioProject
  pending?: string
  run: (key: string, action: () => Promise<StudioProjectState>, success: string) => Promise<void>
}

const nodeKindLabels: Record<WorkflowNode['kind'], string> = {
  operation: '普通操作',
  component: '组件调用',
  'agent-version': 'Agent Version',
  'workflow-version': '子 Workflow Version',
}

export function WorkflowSection({ project, pending, run }: WorkflowSectionProps) {
  const [creating, setCreating] = useState(false)
  const [workflowName, setWorkflowName] = useState('')
  const [workflowDescription, setWorkflowDescription] = useState('')
  const [editingWorkflowId, setEditingWorkflowId] = useState<string>()
  const [nodeKind, setNodeKind] = useState<WorkflowNode['kind']>('operation')
  const [nodeName, setNodeName] = useState('')
  const [nodeReference, setNodeReference] = useState('')
  const [targetWorkflowId, setTargetWorkflowId] = useState('')
  const [edgeWorkflowId, setEdgeWorkflowId] = useState<string>()
  const [edgeFrom, setEdgeFrom] = useState('')
  const [edgeTo, setEdgeTo] = useState('')

  const workflowVersions = useMemo(
    () =>
      project.workflows.flatMap((workflow) =>
        workflow.versions.map((version) => ({ workflow, version })),
      ),
    [project.workflows],
  )

  async function createWorkflow() {
    await run(
      'workflow-create',
      () =>
        window.studio.studioProject!.createWorkflow({
          name: workflowName,
          description: workflowDescription,
          expectedRevision: project.revision,
        }),
      'Workflow 草稿已创建。',
    )
    setCreating(false)
    setWorkflowName('')
    setWorkflowDescription('')
  }

  async function addNode(workflowId: string) {
    const common = { name: nodeName }
    const node =
      nodeKind === 'operation'
        ? ({ ...common, kind: nodeKind, operation: nodeReference } as const)
        : nodeKind === 'component'
          ? ({ ...common, kind: nodeKind, componentId: nodeReference } as const)
          : nodeKind === 'agent-version'
            ? ({ ...common, kind: nodeKind, agentVersionId: nodeReference } as const)
            : ({
                ...common,
                kind: nodeKind,
                workflowId: targetWorkflowId,
                workflowVersionId: nodeReference,
              } as const)
    await run(
      `workflow-node-${workflowId}`,
      () =>
        window.studio.studioProject!.addWorkflowNode({
          workflowId,
          node,
          expectedRevision: project.revision,
        }),
      'Workflow 节点已保存。',
    )
    setEditingWorkflowId(undefined)
    setNodeName('')
    setNodeReference('')
    setTargetWorkflowId('')
  }

  async function addEdge(workflowId: string) {
    await run(
      `workflow-edge-${workflowId}`,
      () =>
        window.studio.studioProject!.addWorkflowEdge({
          workflowId,
          from: edgeFrom,
          to: edgeTo,
          expectedRevision: project.revision,
        }),
      'DAG 连线已保存。',
    )
    setEdgeWorkflowId(undefined)
    setEdgeFrom('')
    setEdgeTo('')
  }

  return (
    <section className="project-section workflow-section" aria-labelledby="project-workflows-title">
      <header>
        <div>
          <h2 id="project-workflows-title">版本化 Workflow DAG</h2>
          <p>结构化编辑、只读图示与不可变版本；保存时拒绝直接和间接循环。</p>
        </div>
        <button
          className="button button--secondary"
          disabled={Boolean(pending)}
          onClick={() => setCreating(true)}
          type="button"
        >
          <Plus aria-hidden="true" size={17} />
          新建 Workflow
        </button>
      </header>

      {creating ? (
        <div className="workflow-form" role="group" aria-label="新建 Workflow">
          <label>
            名称
            <input
              autoFocus
              maxLength={100}
              onChange={(event) => setWorkflowName(event.target.value)}
              value={workflowName}
            />
          </label>
          <label>
            说明
            <input
              maxLength={500}
              onChange={(event) => setWorkflowDescription(event.target.value)}
              value={workflowDescription}
            />
          </label>
          <div>
            <button
              className="button button--primary"
              disabled={!workflowName.trim() || Boolean(pending)}
              onClick={() => void createWorkflow()}
              type="button"
            >
              创建草稿
            </button>
            <button
              className="button button--secondary"
              onClick={() => setCreating(false)}
              type="button"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {project.workflows.length === 0 ? (
        <div className="project-inline-empty">
          <GitBranch aria-hidden="true" size={25} />
          <p>尚无 Workflow。创建草稿后添加结构化节点和有向边，空 Workflow 不能冻结。</p>
        </div>
      ) : (
        <div className="workflow-list">
          {project.workflows.map((workflow) => (
            <article className="workflow-card" key={workflow.id}>
              <header>
                <div>
                  <strong>{workflow.name}</strong>
                  <small>
                    revision {workflow.revision} · {workflow.nodes.length} 节点 ·{' '}
                    {workflow.edges.length} 边 · {workflow.versions.length} Version
                  </small>
                </div>
                <div>
                  <button
                    className="button button--secondary"
                    disabled={Boolean(pending)}
                    onClick={() => setEditingWorkflowId(workflow.id)}
                    type="button"
                  >
                    添加节点
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={workflow.nodes.length < 2 || Boolean(pending)}
                    onClick={() => setEdgeWorkflowId(workflow.id)}
                    type="button"
                  >
                    添加连线
                  </button>
                  <button
                    className="button button--primary"
                    disabled={workflow.nodes.length === 0 || Boolean(pending)}
                    onClick={() =>
                      void run(
                        `workflow-freeze-${workflow.id}`,
                        () =>
                          window.studio.studioProject!.freezeWorkflow({
                            workflowId: workflow.id,
                            expectedRevision: project.revision,
                          }),
                        '已创建或复用相同的 Workflow Version。',
                      )
                    }
                    type="button"
                  >
                    <Snowflake aria-hidden="true" size={16} />
                    冻结 Workflow
                  </button>
                </div>
              </header>

              {editingWorkflowId === workflow.id ? (
                <div
                  className="workflow-form"
                  role="group"
                  aria-label={`为 ${workflow.name} 添加节点`}
                >
                  <label>
                    节点类型
                    <select
                      onChange={(event) => {
                        setNodeKind(event.target.value as WorkflowNode['kind'])
                        setNodeReference('')
                        setTargetWorkflowId('')
                      }}
                      value={nodeKind}
                    >
                      {Object.entries(nodeKindLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    节点名称
                    <input
                      autoFocus
                      onChange={(event) => setNodeName(event.target.value)}
                      value={nodeName}
                    />
                  </label>
                  {nodeKind === 'component' ? (
                    <label>
                      Component
                      <select
                        onChange={(event) => setNodeReference(event.target.value)}
                        value={nodeReference}
                      >
                        <option value="">选择 Component</option>
                        {project.components.map((component) => (
                          <option key={component.id} value={component.id}>
                            {component.descriptor.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : nodeKind === 'workflow-version' ? (
                    <label>
                      子 Workflow Version
                      <select
                        onChange={(event) => {
                          const [workflowId, versionId] = event.target.value.split(':')
                          setTargetWorkflowId(workflowId ?? '')
                          setNodeReference(versionId ?? '')
                        }}
                        value={
                          targetWorkflowId && nodeReference
                            ? `${targetWorkflowId}:${nodeReference}`
                            : ''
                        }
                      >
                        <option value="">选择不可变 Version</option>
                        {workflowVersions.map(({ workflow: target, version }) => (
                          <option key={version.id} value={`${target.id}:${version.id}`}>
                            {target.name} · Version {version.versionNumber}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      {nodeKind === 'operation' ? '操作标识' : 'Agent Version UUID'}
                      <input
                        onChange={(event) => setNodeReference(event.target.value)}
                        value={nodeReference}
                      />
                    </label>
                  )}
                  <div>
                    <button
                      className="button button--primary"
                      disabled={!nodeName.trim() || !nodeReference || Boolean(pending)}
                      onClick={() => void addNode(workflow.id)}
                      type="button"
                    >
                      保存节点
                    </button>
                    <button
                      className="button button--secondary"
                      onClick={() => setEditingWorkflowId(undefined)}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : null}

              {edgeWorkflowId === workflow.id ? (
                <div
                  className="workflow-form workflow-edge-form"
                  role="group"
                  aria-label={`为 ${workflow.name} 添加连线`}
                >
                  <label>
                    起点
                    <select onChange={(event) => setEdgeFrom(event.target.value)} value={edgeFrom}>
                      <option value="">选择起点</option>
                      {workflow.nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ArrowRight aria-hidden="true" size={20} />
                  <label>
                    终点
                    <select onChange={(event) => setEdgeTo(event.target.value)} value={edgeTo}>
                      <option value="">选择终点</option>
                      {workflow.nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <button
                      className="button button--primary"
                      disabled={!edgeFrom || !edgeTo || Boolean(pending)}
                      onClick={() => void addEdge(workflow.id)}
                      type="button"
                    >
                      保存连线
                    </button>
                    <button
                      className="button button--secondary"
                      onClick={() => setEdgeWorkflowId(undefined)}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : null}

              {workflow.nodes.length === 0 ? (
                <div className="project-inline-empty">
                  <p>草稿为空，先添加节点。</p>
                </div>
              ) : (
                <ol className="workflow-graph" aria-label={`${workflow.name} 只读 DAG 图示`}>
                  {workflow.nodes.map((node) => (
                    <li key={node.id}>
                      <div>
                        <small>{nodeKindLabels[node.kind]}</small>
                        <strong>{node.name}</strong>
                        <code>{node.id.slice(0, 8)}</code>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`删除节点 ${node.name}`}
                        disabled={Boolean(pending)}
                        onClick={() =>
                          void run(
                            `workflow-node-remove-${node.id}`,
                            () =>
                              window.studio.studioProject!.removeWorkflowNode({
                                workflowId: workflow.id,
                                nodeId: node.id,
                                expectedRevision: project.revision,
                              }),
                            '节点及其连线已删除，历史 Version 不变。',
                          )
                        }
                        type="button"
                      >
                        <Trash aria-hidden="true" size={16} />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {workflow.edges.length > 0 ? (
                <ul className="workflow-edges" aria-label={`${workflow.name} 有向边`}>
                  {workflow.edges.map((edge) => (
                    <li key={edge.id}>
                      <code>{workflow.nodes.find(({ id }) => id === edge.from)?.name}</code>
                      <ArrowRight aria-hidden="true" size={16} />
                      <code>{workflow.nodes.find(({ id }) => id === edge.to)?.name}</code>
                      <button
                        className="icon-button"
                        aria-label="删除 Workflow 连线"
                        onClick={() =>
                          void run(
                            `workflow-edge-remove-${edge.id}`,
                            () =>
                              window.studio.studioProject!.removeWorkflowEdge({
                                workflowId: workflow.id,
                                edgeId: edge.id,
                                expectedRevision: project.revision,
                              }),
                            'DAG 连线已删除。',
                          )
                        }
                        type="button"
                      >
                        <Trash aria-hidden="true" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {workflow.versions.length > 0 ? (
                <div className="workflow-version-strip">
                  {[...workflow.versions].reverse().map((version) => (
                    <span key={version.id}>
                      <Snowflake aria-hidden="true" size={14} /> Version {version.versionNumber}
                      <code>{version.contentHash.slice(0, 10)}</code>
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
