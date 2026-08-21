import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StudioCoreError } from './project-errors'
import { stableHash, studioProjectSchema } from './project-model'
import { StudioCore } from './studio-core'

const temporaryPaths: string[] = []

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-workflow-'))
  temporaryPaths.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  )
})

describe('versioned Workflow DAG', () => {
  it('creates a structured DAG, rejects a direct cycle without writing, and freezes idempotently', async () => {
    const root = await temporaryProject()
    const core = new StudioCore()
    let state = await core.initProject(root, { name: 'Workflow fixture' })
    state = await core.createWorkflow(root, { name: '研究流水线' })
    const workflowId = state.project.workflows[0].id
    state = await core.addWorkflowNode(root, workflowId, {
      kind: 'operation',
      name: '准备输入',
      operation: 'prepare-input',
    })
    state = await core.addWorkflowNode(root, workflowId, {
      kind: 'agent-version',
      name: '调用 Agent Version',
      agentVersionId: randomUUID(),
    })
    const [first, second] = state.project.workflows[0].nodes
    state = await core.addWorkflowEdge(root, workflowId, first.id, second.id)
    const revisionBeforeCycle = state.project.revision

    await expect(
      core.addWorkflowEdge(root, workflowId, second.id, first.id, {
        expectedRevision: revisionBeforeCycle,
      }),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_CYCLE',
      details: { workflowId, from: second.id, to: first.id },
    } satisfies Partial<StudioCoreError>)
    expect((await core.inspectProject(root)).project.revision).toBe(revisionBeforeCycle)

    const frozen = await core.freezeWorkflowVersion(root, workflowId)
    expect(frozen).toMatchObject({ reused: false, version: { versionNumber: 1 } })
    expect(await core.freezeWorkflowVersion(root, workflowId)).toMatchObject({ reused: true })
    expect(frozen.version.contentHash).toBe(stableHash(frozen.version.snapshot))

    const afterRemoval = await core.removeWorkflowNode(root, workflowId, second.id)
    expect(afterRemoval.project.workflows[0]).toMatchObject({
      nodes: [{ id: first.id }],
      edges: [],
    })
    expect(afterRemoval.project.workflows[0].versions[0].snapshot.nodes).toHaveLength(2)
  })

  it('rejects an indirect cycle across immutable sub-Workflow Versions', () => {
    const now = '2026-08-21T08:00:00.000Z'
    const projectId = randomUUID()
    const workflowAId = randomUUID()
    const workflowBId = randomUUID()
    const versionAId = randomUUID()
    const versionBId = randomUUID()
    const snapshotA = {
      name: 'A',
      description: '',
      nodes: [
        {
          id: randomUUID(),
          name: '调用 B',
          kind: 'workflow-version' as const,
          workflowId: workflowBId,
          workflowVersionId: versionBId,
        },
      ],
      edges: [],
    }
    const snapshotB = {
      name: 'B',
      description: '',
      nodes: [
        {
          id: randomUUID(),
          name: '调用 A',
          kind: 'workflow-version' as const,
          workflowId: workflowAId,
          workflowVersionId: versionAId,
        },
      ],
      edges: [],
    }
    const result = studioProjectSchema.safeParse({
      $schema: 'https://agentstack.studio/schemas/project-v2.json',
      formatVersion: 2,
      id: projectId,
      name: 'Indirect cycle',
      description: '',
      revision: 1,
      components: [],
      stack: { executionMode: 'workflow', componentIds: [], capabilityOwners: [] },
      workflows: [
        {
          id: workflowAId,
          name: 'A',
          description: '',
          revision: 1,
          nodes: [],
          edges: [],
          versions: [
            {
              id: versionAId,
              versionNumber: 1,
              sourceRevision: 0,
              contentHash: stableHash(snapshotA),
              snapshot: snapshotA,
              createdAt: now,
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: workflowBId,
          name: 'B',
          description: '',
          revision: 1,
          nodes: [],
          edges: [],
          versions: [
            {
              id: versionBId,
              versionNumber: 1,
              sourceRevision: 0,
              contentHash: stableHash(snapshotB),
              snapshot: snapshotB,
              createdAt: now,
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      ],
      versions: [],
      createdAt: now,
      updatedAt: now,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map(({ message }) => message)).toContain(
        'Workflow Version 引用检测到直接或间接循环。',
      )
    }
  })

  it('protects Components referenced by Workflow drafts and immutable history', async () => {
    const root = await temporaryProject()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Workflow reference protection' })
    let state = await core.importComponent(root, path.resolve('src/test/fixtures/m7/harness-x'))
    const componentId = state.project.components[0].id
    state = await core.createWorkflow(root, { name: 'Component Workflow' })
    const workflowId = state.project.workflows[0].id
    state = await core.addWorkflowNode(root, workflowId, {
      kind: 'component',
      name: '调用组件',
      componentId,
    })

    await expect(core.deleteComponent(root, componentId)).rejects.toMatchObject({
      code: 'COMPONENT_IN_USE',
      details: { workflowReferences: [{ workflowId, current: true, versions: [] }] },
    })
    const nodeId = state.project.workflows[0].nodes[0].id
    await core.freezeWorkflowVersion(root, workflowId)
    await core.removeWorkflowNode(root, workflowId, nodeId)
    await expect(core.deleteComponent(root, componentId)).rejects.toMatchObject({
      code: 'COMPONENT_IN_USE',
      details: { workflowReferences: [{ workflowId, current: false, versions: [1] }] },
    })
  })
})
