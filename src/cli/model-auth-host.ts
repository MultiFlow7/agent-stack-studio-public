import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { StudioCore } from '../core/studio-core'
import { NativeAgentCore } from '../core/native-agent-core'
import { HostDriverRegistry } from '../adapters/harness/host-driver-registry'
import { MacOsKeychainAdapter } from '../adapters/keychain/macos-keychain-adapter'
import { AgentRepository } from '../main/persistence/agent-repository'
import { ComponentRepository } from '../main/persistence/component-repository'
import { ProjectIndexRepository } from '../main/persistence/project-index-repository'
import { ComponentService } from '../main/components/component-service'
import { StudioProjectService } from '../main/projects/studio-project-service'
import { SecretService } from '../main/secrets/secret-service'
import { ModelAuthService } from '../main/model-auth/model-auth-service'
import { NativeModelAuthGateway } from '../main/model-auth/native-model-auth-gateway'
import { ModelAuthController } from '../main/model-auth/model-auth-controller'

export interface CliModelAuthHandle {
  service: ModelAuthService
  controller: ModelAuthController
  nativeAgent: NativeAgentCore
  close(): void
}

export async function createCliModelAuth(
  rootPath: string,
  core = new StudioCore(),
  dataRootOverride?: string,
): Promise<CliModelAuthHandle> {
  const dataRoot = path.resolve(
    dataRootOverride ??
      process.env.STUDIO_USER_DATA_PATH ??
      path.join(homedir(), 'Library', 'Application Support', 'Agent Stack Studio'),
  )
  await mkdir(dataRoot, { recursive: true, mode: 0o700 })
  const databasePath = path.join(dataRoot, 'studio.sqlite3')
  const agents = new AgentRepository(databasePath)
  const componentsRepository = new ComponentRepository(databasePath)
  const index = new ProjectIndexRepository(databasePath)
  try {
    const components = new ComponentService(componentsRepository)
    const projects = new StudioProjectService({
      core,
      index,
      components,
      agents,
      cliPath: process.argv[1] ?? 'studio',
    })
    components.connectProject(projects)
    await projects.open(rootPath)
    const drivers = new HostDriverRegistry()
    const gateway = new NativeModelAuthGateway({ drivers })
    const secrets = new SecretService({
      repository: agents,
      keychain: new MacOsKeychainAdapter(),
    })
    const service = new ModelAuthService({ repository: agents, secrets, projects, gateway })
    const controller = new ModelAuthController({ service, projects, gateway })
    projects.connectModelAuth(controller)
    return {
      service,
      controller,
      nativeAgent: new NativeAgentCore(drivers, undefined, service),
      close() {
        projects.close()
        index.close()
        componentsRepository.close()
        agents.close()
      },
    }
  } catch (error) {
    index.close()
    componentsRepository.close()
    agents.close()
    throw error
  }
}
