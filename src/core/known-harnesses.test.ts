import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { knownHarnessComponentIds } from './known-harnesses'
import { StudioCore } from './studio-core'

describe('known Native Harness selection', () => {
  it('atomically replaces the execution controller and freezes Profile with the same facts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-known-harness-'))
    const core = new StudioCore()
    let state = await core.initProject(root, { name: 'Harness Agent' })
    state = await core.updateAgentProfile(
      root,
      {
        instructions: '只回答项目事实。',
        memoryMarkdown: '# Memory\n保持简洁。',
        skills: [{ id: 'review', name: 'Review', markdown: '# Review', enabled: true }],
        mcpServers: [],
        toolPolicy: 'read-only',
      },
      { expectedRevision: state.project.revision },
    )
    state = await core.selectKnownHarness(root, 'pi', {
      expectedRevision: state.project.revision,
    })
    state = await core.selectKnownHarness(root, 'openclaw', {
      expectedRevision: state.project.revision,
    })

    expect(state.project.stack.executionMode).toBe('external-harness')
    expect(state.project.stack.componentIds).toContain(knownHarnessComponentIds.openclaw)
    expect(state.project.stack.componentIds).not.toContain(knownHarnessComponentIds.pi)
    const frozen = await core.freezeVersion(root, { expectedRevision: state.project.revision })
    expect(frozen.result.project.versions[0]?.snapshot.profile).toEqual(state.project.profile)
  })
})
