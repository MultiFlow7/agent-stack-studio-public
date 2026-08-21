import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcChannels } from '../../shared/ipc'
import type { RunHistoryDetail } from '../../shared/run'
import { createRunFixture, fixtureRunId } from '../../test/run-fixture'
import type { RunHistoryService } from '../runs/run-history-service'
import type { RunService } from '../runs/run-service'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  handle: vi.fn(),
  removeHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: electron.handle.mockImplementation(
      (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
        electron.handlers.set(channel, handler)
      },
    ),
    removeHandler: electron.removeHandler,
  },
}))

import { registerRunIpc } from './register-run-ipc'

const trustedEvent = {
  senderFrame: { url: 'file:///Applications/Agent%20Stack%20Studio.app/renderer/index.html' },
  sender: { getURL: () => '' },
}

function historyDetail(): RunHistoryDetail {
  const { manifest } = createRunFixture()
  return {
    run: {
      id: manifest.runId,
      agentId: manifest.agentId,
      agentVersionId: manifest.agentVersionId,
      status: 'timed-out',
      manifest,
      startedAt: '2026-08-20T01:00:00.000Z',
      finishedAt: '2026-08-20T01:00:00.500Z',
      failure: { code: 'TIMEOUT', message: 'Run 超过 500 毫秒限制。' },
      createdAt: '2026-08-20T01:00:00.000Z',
      updatedAt: '2026-08-20T01:00:00.500Z',
    },
    events: [],
    artifacts: [],
    history: {
      durationMs: 500,
      variables: {
        prompt: manifest.input.prompt,
        randomSeed: manifest.reproducibility.randomSeed,
        timeoutMs: manifest.reproducibility.timeoutMs,
        retryLimit: 0,
        concurrency: 1,
      },
      experiment: null,
    },
  }
}

describe('Run history IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('returns only the validated immutable history projection', async () => {
    const detail = historyDetail()
    const get = vi.fn(() => detail)
    const cancel = vi.fn(() => detail)
    const unregister = registerRunIpc({
      runs: {
        start: vi.fn(),
        list: vi.fn(() => []),
      } as unknown as RunService,
      history: { get, cancel } as unknown as RunHistoryService,
    })

    await expect(
      electron.handlers.get(ipcChannels.runsGet)?.(trustedEvent, { id: fixtureRunId }),
    ).resolves.toEqual(detail)
    await expect(
      electron.handlers.get(ipcChannels.runsCancel)?.(trustedEvent, { id: fixtureRunId }),
    ).resolves.toEqual(detail)
    expect(get).toHaveBeenCalledWith(fixtureRunId)
    expect(cancel).toHaveBeenCalledWith(fixtureRunId)

    unregister()
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.runsGet)
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.runsCancel)
  })

  it('rejects arbitrary input before reading Run history', async () => {
    const get = vi.fn()
    const cancel = vi.fn()
    registerRunIpc({
      runs: { start: vi.fn(), list: vi.fn(() => []) } as unknown as RunService,
      history: { get, cancel } as unknown as RunHistoryService,
    })

    await expect(
      electron.handlers.get(ipcChannels.runsGet)?.(trustedEvent, {
        id: fixtureRunId,
        databasePath: '/tmp/outside.sqlite3',
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    await expect(
      electron.handlers.get(ipcChannels.runsCancel)?.(trustedEvent, {
        id: fixtureRunId,
        force: true,
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    expect(get).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })
})
