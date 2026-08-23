import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcChannels } from '../../shared/ipc'
import type { StudioDoctorService } from '../doctor/studio-doctor-service'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  removeHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
        electron.handlers.set(channel, handler)
      },
    ),
    removeHandler: electron.removeHandler,
  },
}))

import { registerDoctorIpc } from './register-doctor-ipc'

const trustedFrame = {
  url: 'file:///Applications/Agent%20Stack%20Studio.app/Contents/Resources/app.asar/dist/renderer/index.html',
}
const trustedEvent = {
  senderFrame: trustedFrame,
  sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
}

describe('doctor IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('accepts only the empty input contract and validates the shared report', async () => {
    const run = vi.fn(() =>
      Promise.resolve({
        schemaVersion: 1,
        checkedAt: '2026-08-23T05:00:00.000Z',
        status: 'degraded',
        counts: { passed: 6, warnings: 1, blocking: 0 },
        checks: Array.from({ length: 7 }, (_, index) => ({
          id: `check-${index}`,
          category: 'application',
          status: index === 6 ? 'warning' : 'pass',
          title: `Check ${index}`,
          summary: '已完成安全诊断。',
          remediation: index === 6 ? '配置外部能力。' : null,
          facts: {},
        })),
      }),
    )
    const unregister = registerDoctorIpc({ run } as unknown as StudioDoctorService)
    const handler = electron.handlers.get(ipcChannels.doctorRun)

    await expect(handler?.(trustedEvent, {})).resolves.toMatchObject({ status: 'degraded' })
    await expect(handler?.(trustedEvent, { path: '/tmp/untrusted' })).rejects.toThrow(
      '提交的 Agent 数据无效',
    )
    expect(run).toHaveBeenCalledTimes(1)

    unregister()
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.doctorRun)
  })
})
