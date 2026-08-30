import { describe, expect, it } from 'vitest'
import type { NativeAgentCore } from '../../core/native-agent-core'
import type { HarnessProbe } from '../../shared/native-agent'
import type { DataMaintenanceService } from '../maintenance/data-maintenance-service'
import type { StudioProjectService } from '../projects/studio-project-service'
import { PublisherError } from '../connectors/agent-publisher'
import { probeMulticaReadiness, StudioDoctorService } from './studio-doctor-service'

function harnesses(): HarnessProbe[] {
  return ['pi', 'openclaw', 'codex'].map((id) => ({
    id: id as HarnessProbe['id'],
    label: id,
    executable: id,
    status: 'ready',
    version: '1.0.0',
    requiredVersion: '1.0.0',
    capabilities: {
      prompt: 'native',
      skills: 'native',
      memory: 'native',
      mcp: 'native',
      sessions: 'native',
    },
    detail: `${id} 可用。`,
  }))
}

describe('StudioDoctorService', () => {
  it('collects App, data, project, Harness and Multica facts into the shared report', async () => {
    const doctor = new StudioDoctorService({
      application: {
        version: '0.9.0',
        platform: 'darwin',
        architecture: 'arm64',
        packaged: true,
        bundledCliRuntime: true,
      },
      cliPath: process.execPath,
      maintenance: {
        status: () =>
          Promise.resolve({
            databaseSchemaVersion: 9,
            supportedDatabaseSchemaVersion: 9,
            pendingRestore: false,
            lastRestoreAt: null,
          }),
      } as unknown as DataMaintenanceService,
      projects: {
        current: () =>
          Promise.resolve({
            project: { name: 'Doctor project', revision: 3, formatVersion: 2 },
            integrity: { versionsChecked: 1 },
          }),
      } as unknown as StudioProjectService,
      nativeAgent: { probes: () => Promise.resolve(harnesses()) } as unknown as NativeAgentCore,
      publisher: {
        runtimes: () =>
          Promise.resolve([
            { id: 'runtime-1', label: 'Pi Runtime', provider: 'pi', status: 'online' },
          ]),
      },
      now: () => new Date('2026-08-23T05:00:00.000Z'),
    })

    await expect(doctor.run()).resolves.toMatchObject({
      checkedAt: '2026-08-23T05:00:00.000Z',
      status: 'ready',
      counts: { passed: 9, warnings: 0, blocking: 0 },
    })
  })

  it('turns missing authentication into a truthful non-secret readiness fact', async () => {
    await expect(
      probeMulticaReadiness({
        runtimes: () =>
          Promise.reject(
            new PublisherError('MULTICA_AUTHENTICATION_REQUIRED', 'secret remote detail', false),
          ),
      }),
    ).resolves.toEqual({
      status: 'authentication-required',
      runtimeCount: 0,
      onlineRuntimeCount: 0,
      message: 'Multica CLI 尚未登录或凭证已失效。',
    })
  })
})
