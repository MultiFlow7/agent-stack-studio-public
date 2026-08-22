import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executeCliCommand, parseArguments } from '../../cli/studio'
import type { StudioProject } from '../../core/project-model'
import { ComponentService } from '../components/component-service'
import { ComponentRepository } from '../persistence/component-repository'
import { ProjectIndexRepository } from '../persistence/project-index-repository'
import { AgentRepository } from '../persistence/agent-repository'
import { StudioProjectService } from './studio-project-service'

const directories: string[] = []

function nextExternalChange(service: StudioProjectService): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('External change was not observed.')), 5_000)
    const remove = service.onChanged(() => {
      clearTimeout(timeout)
      remove()
      resolve()
    })
  })
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  )
})

describe('StudioProjectService GUI/CLI consistency', () => {
  it('makes a library import immediately selectable by the project Agent without SQLite duplication', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studio-project-library-'))
    directories.push(directory)
    const databasePath = path.join(directory, 'studio.sqlite3')
    const componentRepository = new ComponentRepository(databasePath)
    const agentRepository = new AgentRepository(databasePath)
    const index = new ProjectIndexRepository(databasePath)
    const components = new ComponentService(componentRepository)
    const service = new StudioProjectService({
      index,
      components,
      agents: agentRepository,
      cliPath: '/Applications/Agent Stack Studio.app/Contents/Resources/studio.mjs',
    })
    components.connectProject(service)
    let state = await service.init(path.join(directory, 'project'))
    state = await service.importComponent(
      path.resolve('src/test/fixtures/m7/harness-x'),
      state.project!.revision,
    )

    expect(components.list().map(({ id }) => id)).toEqual([state.project!.components[0].id])
    expect(componentRepository.list()).toEqual([])
    state = await service.stackAdd(state.project!.components[0].id, state.project!.revision)
    expect(components.getStack(state.localAgentId!).components).toHaveLength(1)

    service.close()
    index.close()
    agentRepository.close()
    componentRepository.close()
  })

  it('writes through Studio Core, lets CLI read the same state, and reports later CLI changes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studio-project-service-'))
    directories.push(directory)
    const projectRoot = path.join(directory, 'project')
    const databasePath = path.join(directory, 'studio.sqlite3')
    const componentRepository = new ComponentRepository(databasePath)
    const index = new ProjectIndexRepository(databasePath)
    const service = new StudioProjectService({
      index,
      components: new ComponentService(componentRepository),
      cliPath:
        '/Applications/Agent Stack Studio.app/Contents/Resources/app.asar.unpacked/dist/cli/studio.mjs',
    })
    let state = await service.init(projectRoot)
    state = await service.importComponent(
      path.resolve('src/test/fixtures/m7/harness-x'),
      state.project!.revision,
    )
    const component = state.project!.components[0]
    state = await service.stackAdd(component.id, state.project!.revision)

    const cliInspect = await executeCliCommand(
      parseArguments(['project', 'inspect', '--project', projectRoot, '--json']),
    )
    expect((cliInspect.data as { project: StudioProject }).project.stack.componentIds).toEqual([
      component.id,
    ])

    const changed = nextExternalChange(service)
    await executeCliCommand(
      parseArguments(['stack', 'remove', component.id, '--project', projectRoot, '--json']),
    )
    expect((await service.summary()).project!.stack.componentIds).toEqual([])
    await changed
    expect((await service.current(true)).project!.stack.componentIds).toEqual([])

    const changedAgain = nextExternalChange(service)
    await executeCliCommand(
      parseArguments(['stack', 'add', component.id, '--project', projectRoot, '--json']),
    )
    await changedAgain
    expect((await service.current(true)).project!.stack.componentIds).toEqual([component.id])

    const guiPackagePath = path.join(directory, 'gui.agent-stack-package.json')
    const cliPackagePath = path.join(directory, 'cli.agent-stack-package.json')
    const guiExport = await service.exportTo(guiPackagePath)
    const cliExport = await executeCliCommand(
      parseArguments([
        'project',
        'export',
        '--project',
        projectRoot,
        '--output',
        cliPackagePath,
        '--json',
      ]),
    )
    expect(guiExport).toMatchObject({ status: 'exported' })
    expect(cliExport.data).toMatchObject({
      status: 'exported',
      packageHash: guiExport.status === 'exported' ? guiExport.packageHash : '',
    })
    expect(JSON.parse(await readFile(guiPackagePath, 'utf8'))).toEqual(
      JSON.parse(await readFile(cliPackagePath, 'utf8')),
    )

    service.close()
    index.close()
    componentRepository.close()
  })

  it('passes backup recovery and shared integrity state to the GUI', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studio-project-recovery-'))
    directories.push(directory)
    const projectRoot = path.join(directory, 'project')
    const databasePath = path.join(directory, 'studio.sqlite3')
    const componentRepository = new ComponentRepository(databasePath)
    const index = new ProjectIndexRepository(databasePath)
    const service = new StudioProjectService({
      index,
      components: new ComponentService(componentRepository),
      cliPath: '/Applications/Agent Stack Studio.app/Contents/Resources/studio.mjs',
    })
    const state = await service.init(projectRoot)
    await service.importComponent(
      path.resolve('src/test/fixtures/m7/harness-x'),
      state.project!.revision,
    )
    const changed = nextExternalChange(service)
    await writeFile(path.join(projectRoot, '.agent-stack'), '{broken', 'utf8')
    await changed

    const recovered = await service.current()
    expect(recovered.recovered).toBe(true)
    expect(recovered.integrity).toMatchObject({ status: 'verified', versionsChecked: 0 })

    service.close()
    index.close()
    componentRepository.close()
  })
})
