import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultApplicationPreferences } from '../../shared/preferences'
import { ProjectIndexRepository } from '../persistence/project-index-repository'
import {
  ApplicationPreferencesService,
  resolveWindowPlacement,
} from './application-preferences-service'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function repository(): Promise<{ repository: ProjectIndexRepository; databasePath: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-preferences-'))
  directories.push(directory)
  const databasePath = path.join(directory, 'studio.sqlite3')
  return { repository: new ProjectIndexRepository(databasePath), databasePath }
}

describe('ApplicationPreferencesService', () => {
  it('persists validated Renderer and window state in the existing local preference table', async () => {
    const first = await repository()
    const preferences = new ApplicationPreferencesService(first.repository)
    expect(preferences.current()).toEqual(defaultApplicationPreferences)

    expect(preferences.updateRenderer({ sidebarCollapsed: true, lastView: 'settings' })).toEqual({
      sidebarCollapsed: true,
      lastView: 'settings',
    })
    preferences.updateWindow({ x: 120, y: 80, width: 1320, height: 840 }, true)
    first.repository.close()

    const reopened = new ProjectIndexRepository(first.databasePath)
    expect(new ApplicationPreferencesService(reopened).current()).toMatchObject({
      contractVersion: 1,
      renderer: { sidebarCollapsed: true, lastView: 'settings' },
      window: { x: 120, y: 80, width: 1320, height: 840, maximized: true },
    })
    reopened.close()
  })

  it('falls back to safe defaults when a stored preference has an unknown contract', async () => {
    const fixture = await repository()
    fixture.repository.setPreference('application-ui-v1', {
      contractVersion: 99,
      renderer: { sidebarCollapsed: 'yes', lastView: '../outside' },
      window: { width: -1 },
    })

    expect(new ApplicationPreferencesService(fixture.repository).current()).toEqual(
      defaultApplicationPreferences,
    )
    fixture.repository.close()
  })

  it('restores visible bounds and drops off-screen coordinates after display changes', () => {
    const visible = structuredClone(defaultApplicationPreferences)
    visible.window = { x: 100, y: 80, width: 1400, height: 900, maximized: true }
    expect(resolveWindowPlacement(visible, [{ x: 0, y: 0, width: 1728, height: 1080 }])).toEqual({
      x: 100,
      y: 80,
      width: 1400,
      height: 900,
      maximized: true,
    })

    visible.window = { x: 5000, y: 5000, width: 3000, height: 2000, maximized: false }
    expect(resolveWindowPlacement(visible, [{ x: 0, y: 0, width: 1440, height: 900 }])).toEqual({
      width: 1440,
      height: 900,
      maximized: false,
    })
  })
})
