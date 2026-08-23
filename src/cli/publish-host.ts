import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { StudioCore } from '../core/studio-core'
import type { NativeAgentCore } from '../core/native-agent-core'
import { StudioCoreError } from '../core/project-errors'
import { AgentRepository } from '../main/persistence/agent-repository'
import { ComponentRepository } from '../main/persistence/component-repository'
import { ProjectIndexRepository } from '../main/persistence/project-index-repository'
import { PublishRepository } from '../main/persistence/publish-repository'
import { AgentService } from '../main/agents/agent-service'
import { ComponentService } from '../main/components/component-service'
import { WorkspaceService } from '../main/workspace/workspace-service'
import { StudioProjectService } from '../main/projects/studio-project-service'
import { PublishService } from '../main/publishing/publish-service'
import { MulticaCliPublisher } from '../main/connectors/multica-cli-publisher'

export interface CliPublishingHandle {
  service: PublishService
  agentId: string
  close(): void
}

export async function createCliPublishing(
  rootPath: string,
  core: StudioCore,
  nativeAgent: NativeAgentCore,
  dataRootOverride?: string,
): Promise<CliPublishingHandle> {
  const dataRoot = path.resolve(
    dataRootOverride ??
      process.env.STUDIO_USER_DATA_PATH ??
      path.join(homedir(), 'Library', 'Application Support', 'Agent Stack Studio'),
  )
  await mkdir(dataRoot, { recursive: true, mode: 0o700 })
  const databasePath = path.join(dataRoot, 'studio.sqlite3')
  const agentsRepository = new AgentRepository(databasePath)
  const componentsRepository = new ComponentRepository(databasePath)
  const indexRepository = new ProjectIndexRepository(databasePath)
  const publishRepository = new PublishRepository(databasePath)
  try {
    const components = new ComponentService(componentsRepository)
    const agents = new AgentService(
      agentsRepository,
      new WorkspaceService(path.join(dataRoot, 'workspaces')),
    )
    const projects = new StudioProjectService({
      core,
      index: indexRepository,
      components,
      agents: agentsRepository,
      cliPath: process.argv[1] ?? 'studio',
    })
    components.connectProject(projects)
    agents.connectProject(projects)
    await projects.open(rootPath)
    const state = await projects.current()
    if (!state.project || !state.projectPath || !state.localAgentId) {
      throw new StudioCoreError('PROJECT_NOT_FOUND', '请先打开有效的 .agent-stack 项目。')
    }
    for (const version of state.project.versions) {
      agentsRepository.createProjectVersionReference(state.localAgentId, state.project, version)
    }
    return {
      agentId: state.localAgentId,
      service: new PublishService({
        agents,
        components,
        runs: { list: () => [] },
        repository: publishRepository,
        publisher: new MulticaCliPublisher({ cwd: path.dirname(state.projectPath) }),
        nativeVerification: (agentId, agentVersionId) =>
          projects.nativeVersionVerified(agentId, agentVersionId, nativeAgent),
      }),
      close() {
        publishRepository.close()
        indexRepository.close()
        componentsRepository.close()
        agentsRepository.close()
      },
    }
  } catch (error) {
    publishRepository.close()
    indexRepository.close()
    componentsRepository.close()
    agentsRepository.close()
    throw error
  }
}
