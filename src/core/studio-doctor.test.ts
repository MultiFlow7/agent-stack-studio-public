import { describe, expect, it } from 'vitest'
import { buildStudioDoctorReport } from './studio-doctor'
import type { StudioDoctorFacts } from '../shared/doctor'

function facts(): StudioDoctorFacts {
  return {
    application: {
      version: '0.9.0',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: true,
      cliExecutable: true,
      bundledCliRuntime: true,
    },
    data: {
      databaseSchemaVersion: 9,
      supportedDatabaseSchemaVersion: 9,
      pendingRestore: false,
      lastRestoreAt: null,
    },
    project: {
      status: 'healthy',
      name: 'Doctor fixture',
      revision: 4,
      formatVersion: 2,
      versionsChecked: 1,
      message: '项目事实、内容哈希和不可变版本已验证。',
    },
    harnesses: ['pi', 'openclaw', 'codex'].map((id) => ({
      id: id as 'pi' | 'openclaw' | 'codex',
      label: id,
      executable: id,
      status: 'ready' as const,
      version: '1.0.0',
      requiredVersion: '1.0.0',
      capabilities: {
        prompt: 'native' as const,
        skills: 'native' as const,
        memory: 'native' as const,
        mcp: 'native' as const,
        sessions: 'native' as const,
      },
      detail: `${id} 可用。`,
    })),
    multica: {
      status: 'ready',
      runtimeCount: 1,
      onlineRuntimeCount: 1,
      message: 'Multica 已登录，1 个 Runtime 在线。',
    },
  }
}

describe('Studio doctor core', () => {
  it('returns a stable ready report when every distribution boundary is satisfied', () => {
    const report = buildStudioDoctorReport(facts(), () => new Date('2026-08-23T05:00:00.000Z'))

    expect(report.status).toBe('ready')
    expect(report.counts).toEqual({ passed: 9, warnings: 0, blocking: 0 })
    expect(report.checks.map(({ id }) => id)).toEqual([
      'application-platform',
      'cli-distribution',
      'database-migration',
      'backup-recovery',
      'project-integrity',
      'harness-pi',
      'harness-openclaw',
      'harness-codex',
      'multica-publish',
    ])
  })

  it('reports external readiness gaps without inventing a successful publish path', () => {
    const input = facts()
    input.application.bundledCliRuntime = false
    input.project.status = 'failed'
    input.project.message = '项目哈希不匹配。'
    input.harnesses[0].status = 'not-installed'
    input.multica = {
      status: 'not-installed',
      runtimeCount: 0,
      onlineRuntimeCount: 0,
      message: '未找到 Multica CLI。',
    }

    const report = buildStudioDoctorReport(input)

    expect(report.status).toBe('blocked')
    expect(report.counts.blocking).toBe(2)
    expect(report.checks.find(({ id }) => id === 'multica-publish')).toMatchObject({
      status: 'warning',
      facts: { status: 'not-installed', runtimeCount: 0, onlineRuntimeCount: 0 },
    })
  })
})
