import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioCore } from '../../core/studio-core'
import { ProjectIndexRepository } from './project-index-repository'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  )
})

describe('ProjectIndexRepository', () => {
  it('indexes only local path and observation metadata while the project file remains authoritative', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studio-project-index-'))
    directories.push(directory)
    const projectRoot = path.join(directory, 'portable-project')
    const result = await new StudioCore().initProject(projectRoot, { name: 'Portable project' })
    const repository = new ProjectIndexRepository(path.join(directory, 'studio.sqlite3'))
    const indexed = repository.touch(result.path, result.project)

    expect(indexed).toMatchObject({
      id: result.project.id,
      projectPath: result.path,
      displayName: 'Portable project',
      lastSeenRevision: 0,
    })
    expect(repository.latest()).toEqual(indexed)
    repository.setPreference('demo-data-loaded', false)
    expect(repository.preference('demo-data-loaded')).toBe(false)
    repository.setComponentPath(result.project.id, 'component-1', '/tmp/local-component')
    expect(repository.componentPath(result.project.id, 'component-1')).toBe('/tmp/local-component')
    repository.close()
  })
})
