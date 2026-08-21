import { z } from 'zod'
import { StudioCoreError } from './project-errors'
import { stableHash, type StudioProject } from './project-model'

export const projectVersionIntegritySchema = z
  .object({
    id: z.uuid(),
    versionNumber: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal('verified'),
  })
  .strict()

export const projectIntegrityReportSchema = z
  .object({
    status: z.literal('verified'),
    algorithm: z.literal('sha256'),
    projectId: z.uuid(),
    revision: z.number().int().nonnegative(),
    versionsChecked: z.number().int().nonnegative(),
    versions: z.array(projectVersionIntegritySchema),
    checkedAt: z.iso.datetime(),
  })
  .strict()

export type ProjectIntegrityReport = z.infer<typeof projectIntegrityReportSchema>

interface IntegrityFailure {
  code: string
  versionId?: string
  versionNumber?: number
  detail: string
}

export function verifyProjectIntegrity(
  project: StudioProject,
  checkedAt = new Date().toISOString(),
): ProjectIntegrityReport {
  const failures: IntegrityFailure[] = []
  for (const workflow of project.workflows) {
    const workflowVersionIds = new Set<string>()
    const workflowVersionHashes = new Set<string>()
    workflow.versions.forEach((version, index) => {
      const snapshotHash = stableHash(version.snapshot)
      if (snapshotHash !== version.contentHash) {
        failures.push({
          code: 'WORKFLOW_VERSION_HASH_MISMATCH',
          versionId: version.id,
          versionNumber: version.versionNumber,
          detail: `Workflow“${workflow.name}”版本 ${version.versionNumber} 的快照哈希不一致。`,
        })
      }
      if (version.versionNumber !== index + 1) {
        failures.push({
          code: 'WORKFLOW_VERSION_SEQUENCE_INVALID',
          versionId: version.id,
          versionNumber: version.versionNumber,
          detail: `Workflow“${workflow.name}”版本序号必须连续。`,
        })
      }
      if (workflowVersionIds.has(version.id) || workflowVersionHashes.has(version.contentHash)) {
        failures.push({
          code: 'WORKFLOW_VERSION_DUPLICATE',
          versionId: version.id,
          versionNumber: version.versionNumber,
          detail: `Workflow“${workflow.name}”包含重复的不可变版本。`,
        })
      }
      if (version.sourceRevision >= workflow.revision) {
        failures.push({
          code: 'WORKFLOW_VERSION_REVISION_INVALID',
          versionId: version.id,
          versionNumber: version.versionNumber,
          detail: `Workflow“${workflow.name}”版本来源 revision 不是已提交历史。`,
        })
      }
      workflowVersionIds.add(version.id)
      workflowVersionHashes.add(version.contentHash)
    })
  }
  const versionIds = new Set<string>()
  const versionHashes = new Set<string>()
  const versions = project.versions.map((version, index) => {
    const snapshotHash = stableHash(version.snapshot)
    const identify = { versionId: version.id, versionNumber: version.versionNumber }
    if (version.contentHash !== snapshotHash) {
      failures.push({
        code: 'VERSION_HASH_MISMATCH',
        ...identify,
        detail: `版本 ${version.versionNumber} 的快照与 contentHash 不一致。`,
      })
    }
    if (version.versionNumber !== index + 1) {
      failures.push({
        code: 'VERSION_SEQUENCE_INVALID',
        ...identify,
        detail: `版本序号应为 ${index + 1}，实际为 ${version.versionNumber}。`,
      })
    }
    if (versionIds.has(version.id)) {
      failures.push({
        code: 'VERSION_ID_DUPLICATE',
        ...identify,
        detail: `版本 ID ${version.id} 重复。`,
      })
    }
    if (versionHashes.has(version.contentHash)) {
      failures.push({
        code: 'VERSION_HASH_DUPLICATE',
        ...identify,
        detail: `版本 ${version.versionNumber} 与历史版本重复，未遵守冻结幂等契约。`,
      })
    }
    versionIds.add(version.id)
    versionHashes.add(version.contentHash)

    if (version.snapshot.project.id !== project.id) {
      failures.push({
        code: 'VERSION_PROJECT_MISMATCH',
        ...identify,
        detail: `版本 ${version.versionNumber} 不属于当前项目。`,
      })
    }
    if (version.sourceRevision >= project.revision) {
      failures.push({
        code: 'VERSION_REVISION_INVALID',
        ...identify,
        detail: `版本 ${version.versionNumber} 的来源 revision 不是已提交历史。`,
      })
    }
    const workflowComponentIds = (version.snapshot.workflows ?? []).flatMap((workflow) => [
      ...workflow.nodes.flatMap((node) => (node.kind === 'component' ? [node.componentId] : [])),
      ...workflow.versions.flatMap(({ snapshot }) =>
        snapshot.nodes.flatMap((node) => (node.kind === 'component' ? [node.componentId] : [])),
      ),
    ])
    const expectedComponentIds = [
      ...new Set([...version.snapshot.stack.componentIds, ...workflowComponentIds]),
    ]
    const componentIds = version.snapshot.components.map(({ id }) => id)
    if (JSON.stringify(componentIds) !== JSON.stringify(expectedComponentIds)) {
      failures.push({
        code: 'VERSION_COMPONENT_SET_MISMATCH',
        ...identify,
        detail: `版本 ${version.versionNumber} 的组件快照与 Stack 不一致。`,
      })
    }
    for (const owner of version.snapshot.stack.capabilityOwners) {
      const ownerComponent = version.snapshot.components.find(({ id }) => id === owner.componentId)
      if (
        !ownerComponent ||
        !ownerComponent.descriptor.provides.some(
          ({ capability }) => capability === owner.capability,
        )
      ) {
        failures.push({
          code: 'VERSION_OWNER_INVALID',
          ...identify,
          detail: `版本 ${version.versionNumber} 的 Owner 不在快照 Stack 中或未提供对应能力。`,
        })
      }
    }
    return projectVersionIntegritySchema.parse({
      id: version.id,
      versionNumber: version.versionNumber,
      contentHash: version.contentHash,
      snapshotHash,
      status: 'verified',
    })
  })

  if (failures.length > 0) {
    throw new StudioCoreError(
      'PROJECT_INTEGRITY_FAILED',
      '不可变项目版本完整性检查失败。请运行 studio project audit --json，并人工检查 .agent-stack.backup。',
      {
        details: { projectId: project.id, revision: project.revision, failures },
        suggestedActions: [
          {
            command: 'studio project audit --json',
            description: '获取结构化完整性错误，不继续修改项目。',
          },
          {
            description: '检查 .agent-stack.backup，并保留当前文件用于人工比较与恢复。',
          },
        ],
      },
    )
  }

  return projectIntegrityReportSchema.parse({
    status: 'verified',
    algorithm: 'sha256',
    projectId: project.id,
    revision: project.revision,
    versionsChecked: versions.length,
    versions,
    checkedAt,
  })
}
