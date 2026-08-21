import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyProjectIntegrity } from './project-integrity'
import { stableHash, studioProjectSchema } from './project-model'

function projectWithVersion() {
  const now = '2026-08-20T08:00:00.000Z'
  const projectId = randomUUID()
  const snapshot = {
    project: { id: projectId, name: 'Integrity fixture' },
    stack: { executionMode: 'agent-loop' as const, componentIds: [], capabilityOwners: [] },
    components: [],
  }
  return studioProjectSchema.parse({
    $schema: 'https://agentstack.studio/schemas/project-v2.json',
    formatVersion: 2,
    id: projectId,
    name: 'Integrity fixture',
    description: '',
    revision: 1,
    components: [],
    stack: snapshot.stack,
    workflows: [],
    versions: [
      {
        id: randomUUID(),
        versionNumber: 1,
        sourceRevision: 0,
        contentHash: stableHash(snapshot),
        snapshot,
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  })
}

describe('project integrity', () => {
  it('recomputes every immutable snapshot hash', () => {
    const project = projectWithVersion()
    expect(verifyProjectIntegrity(project, '2026-08-20T09:00:00.000Z')).toMatchObject({
      status: 'verified',
      algorithm: 'sha256',
      versionsChecked: 1,
      versions: [{ contentHash: project.versions[0].contentHash, status: 'verified' }],
    })
  })

  it('rejects snapshot tampering and invalid history semantics', () => {
    const tampered = projectWithVersion()
    tampered.versions[0].snapshot.project.name = 'Tampered'
    expect(() => verifyProjectIntegrity(tampered)).toThrow(/完整性检查失败/)

    const wrongSequence = projectWithVersion()
    wrongSequence.versions[0].versionNumber = 2
    expect(() => verifyProjectIntegrity(wrongSequence)).toThrow(/完整性检查失败/)
  })
})
