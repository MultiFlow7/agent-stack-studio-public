import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import { SettingsView } from './SettingsView'

const selectionId = '79f5c495-443c-4e88-8332-a761f07519b7'
const dataLocations = [
  [
    'application-support',
    'Application Support',
    '/Users/test/Library/Application Support/Agent Stack Studio',
    false,
  ],
  [
    'database',
    'SQLite',
    '/Users/test/Library/Application Support/Agent Stack Studio/studio.sqlite3',
    true,
  ],
  [
    'workspaces',
    'Workspaces',
    '/Users/test/Library/Application Support/Agent Stack Studio/workspaces',
    true,
  ],
  [
    'artifacts',
    'Artifacts',
    '/Users/test/Library/Application Support/Agent Stack Studio/artifacts',
    true,
  ],
  [
    'recovery',
    'Recovery',
    '/Users/test/Library/Application Support/Agent Stack Studio/recovery',
    false,
  ],
  ['logs', 'Logs', '/Users/test/Library/Application Support/Agent Stack Studio/logs', false],
].map(([id, label, locationPath, includedInBackup]) => ({
  id,
  label,
  path: locationPath,
  kind: id === 'database' ? ('file' as const) : ('directory' as const),
  purpose: `${label} 用途`,
  includedInBackup,
}))

function installApi() {
  const createBackup = vi.fn(() =>
    Promise.resolve({
      status: 'saved' as const,
      backupName: 'Agent Stack Studio Backup 20260819T123456Z',
      createdAt: '2026-08-19T12:34:56.000Z',
      databaseSchemaVersion: 6,
      fileCount: 3,
      sizeBytes: 2048,
      excludedSymbolicLinks: 0,
    }),
  )
  const selectRestore = vi.fn(() =>
    Promise.resolve({
      status: 'selected' as const,
      preview: {
        selectionId,
        backupName: 'Agent Stack Studio Backup 20260819T123456Z',
        createdAt: '2026-08-19T12:34:56.000Z',
        sourceApplicationVersion: '0.1.0',
        sourceDatabaseSchemaVersion: 5,
        targetDatabaseSchemaVersion: 6,
        migrationRequired: true,
        fileCount: 3,
        sizeBytes: 2048,
        excludedSymbolicLinks: 0,
      },
    }),
  )
  const applyRestore = vi.fn(() =>
    Promise.resolve({
      status: 'restarting' as const,
      backupName: 'Agent Stack Studio Backup 20260819T123456Z',
    }),
  )
  const revealDataLocation = vi.fn(({ id }: { id: string }) =>
    Promise.resolve({ status: 'revealed' as const, id }),
  )
  window.studio = {
    maintenance: {
      status: vi.fn(() =>
        Promise.resolve({
          applicationVersion: '0.2.0',
          databaseSchemaVersion: 6,
          supportedDatabaseSchemaVersion: 6,
          pendingRestore: false,
          lastRestoreAt: null,
          packaged: true,
          platform: 'darwin' as const,
          dataLocations,
        }),
      ),
      createBackup,
      selectRestore,
      applyRestore,
      revealDataLocation,
    },
  } as unknown as StudioApi
  return { createBackup, selectRestore, applyRestore, revealDataLocation }
}

describe('SettingsView', () => {
  beforeEach(() => installApi())

  it('creates a verified backup from the keyboard and explains exclusions', async () => {
    const { createBackup } = installApi()
    const user = userEvent.setup()
    render(<SettingsView />)

    expect(await screen.findByText('v6，当前版本')).toBeVisible()
    expect(screen.getByText('密钥原文与日志不会进入备份')).toBeVisible()
    const backupButton = screen.getByRole('button', { name: '选择位置并创建备份' })
    backupButton.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(createBackup).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Agent Stack Studio Backup 20260819T123456Z/)).toBeVisible()
    expect(screen.getByText(/3 个文件，2.0 KB/)).toBeVisible()
  })

  it('requires explicit confirmation before staging a restore and restart', async () => {
    const { selectRestore, applyRestore } = installApi()
    const user = userEvent.setup()
    render(<SettingsView />)

    const selectButton = await screen.findByRole('button', { name: '选择备份并检查' })
    selectButton.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(selectRestore).toHaveBeenCalledTimes(1))

    expect(await screen.findByText('备份检查通过')).toBeVisible()
    expect(screen.getByText('v5，重启后迁移至 v6')).toBeVisible()
    const restoreButton = screen.getByRole('button', { name: '恢复备份并重启' })
    expect(restoreButton).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /我了解当前 SQLite/ }))
    restoreButton.focus()
    await user.keyboard('{Enter}')

    expect(applyRestore).toHaveBeenCalledWith({ selectionId, confirmed: true })
    expect(await screen.findByText(/应用正在重启/)).toBeVisible()
  })

  it('shows stable storage and uninstall boundaries and reveals only a location identifier', async () => {
    const { revealDataLocation } = installApi()
    const user = userEvent.setup()
    render(<SettingsView />)

    expect(await screen.findByRole('heading', { name: '存储与卸载边界' })).toBeVisible()
    expect(
      screen.getByText('/Users/test/Library/Application Support/Agent Stack Studio/studio.sqlite3'),
    ).toBeVisible()
    expect(screen.getByText('卸载应用不会删除这些数据')).toBeVisible()
    expect(
      screen.getByText(/\u5916\u90e8 \.agent-stack \u9879\u76ee\u4e0d\u53d7\u5f71\u54cd/),
    ).toBeVisible()

    const revealButton = screen.getByRole('button', { name: '在 Finder 中显示 Recovery' })
    revealButton.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(revealDataLocation).toHaveBeenCalledWith({ id: 'recovery' }))
    expect(await screen.findByText('已在 Finder 中打开所选位置。')).toBeVisible()
  })
})
