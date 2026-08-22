import { app, BrowserWindow, Menu, net, screen, session } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ipcChannels } from '../shared/ipc'
import { AgentService } from './agents/agent-service'
import { ComponentService } from './components/component-service'
import { ImportService } from './import/import-service'
import { ExperimentService } from './experiments/experiment-service'
import { MulticaContractTestPublisher } from './connectors/multica-contract-test-publisher'
import { registerAgentIpc } from './ipc/register-agent-ipc'
import { AgentStatusService } from './agents/agent-status-service'
import { ComponentCatalogService } from './components/component-catalog-service'
import { registerComponentIpc } from './ipc/register-component-ipc'
import { registerExperimentIpc } from './ipc/register-experiment-ipc'
import { registerRunIpc } from './ipc/register-run-ipc'
import { registerPublishIpc } from './ipc/register-publish-ipc'
import { registerMaintenanceIpc } from './ipc/register-maintenance-ipc'
import { AppLogger } from './logging/logger'
import { AgentRepository } from './persistence/agent-repository'
import { ComponentRepository } from './persistence/component-repository'
import { ExperimentRepository } from './persistence/experiment-repository'
import { RunRepository } from './persistence/run-repository'
import { PublishRepository } from './persistence/publish-repository'
import { PublishService } from './publishing/publish-service'
import { RuntimeController } from './runtime/runtime-controller'
import { ArtifactService } from './runs/artifact-service'
import { RunService } from './runs/run-service'
import { RunHistoryService } from './runs/run-history-service'
import { WorkspaceService } from './workspace/workspace-service'
import { DataMaintenanceService } from './maintenance/data-maintenance-service'
import { ProjectIndexRepository } from './persistence/project-index-repository'
import { StudioProjectService } from './projects/studio-project-service'
import { ChildProcessCompatibilityRuntime } from '../core/trusted-compatibility-runtime'
import { migrateLegacyPortableFacts } from './projects/legacy-portable-migration'
import { registerStudioProjectIpc } from './ipc/register-studio-project-ipc'
import { GithubDiscoveryProvider } from '../adapters/github/github-discovery-provider'
import { DiscoveryService } from './discovery/discovery-service'
import { registerDiscoveryIpc } from './ipc/register-discovery-ipc'
import { MacOsKeychainAdapter } from '../adapters/keychain/macos-keychain-adapter'
import { MacOsSecureInputPrompt } from '../adapters/keychain/macos-secure-input'
import { SecretService } from './secrets/secret-service'
import { registerSecretIpc } from './ipc/register-secret-ipc'
import { hardenSession, hardenWebContents } from './security/electron-security'
import { parseLaunchOptions } from './launch-options'
import {
  ApplicationPreferencesService,
  resolveWindowPlacement,
} from './preferences/application-preferences-service'
import { registerPreferencesIpc } from './ipc/register-preferences-ipc'
import { defaultApplicationPreferences } from '../shared/preferences'
import { CommandCenterService } from './command-center/command-center-service'
import { registerCommandCenterIpc } from './ipc/register-command-center-ipc'
import { sanitizedErrorMessage } from '../shared/sensitive-data'

app.enableSandbox()
process.umask(0o077)

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const captureUserDataPath = process.env.STUDIO_CAPTURE_USER_DATA_PATH
if (
  captureUserDataPath &&
  (process.env.STUDIO_CAPTURE_PATH || process.env.STUDIO_PACKAGED_E2E === '1')
) {
  app.setPath('userData', captureUserDataPath)
}
const ownsSingleInstanceLock = app.requestSingleInstanceLock()
if (!ownsSingleInstanceLock) app.quit()
let mainWindow: BrowserWindow | undefined
let repository: AgentRepository | undefined
let componentRepository: ComponentRepository | undefined
let runRepository: RunRepository | undefined
let experimentRepository: ExperimentRepository | undefined
let publishRepository: PublishRepository | undefined
let projectIndexRepository: ProjectIndexRepository | undefined
let unregisterIpc: (() => void) | undefined
let runtime: RuntimeController | undefined
let experimentService: ExperimentService | undefined
let studioProjectService: StudioProjectService | undefined
let discoveryService: DiscoveryService | undefined
let removeSessionHardening: (() => void) | undefined
let applicationPreferences: ApplicationPreferencesService | undefined

function createApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { label: `关于 ${app.name}`, role: 'about' },
        { type: 'separator' },
        {
          label: '设置…',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send(ipcChannels.menuOpenSettings),
        },
        { type: 'separator' },
        { label: `隐藏 ${app.name}`, role: 'hide' },
        { label: '隐藏其他应用', role: 'hideOthers' },
        { label: '全部显示', role: 'unhide' },
        { type: 'separator' },
        { label: `退出 ${app.name}`, role: 'quit' },
      ],
    },
    {
      label: '文件',
      submenu: [
        {
          label: '新建 Agent',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send(ipcChannels.menuCreateAgent),
        },
        { type: 'separator' },
        { label: '关闭窗口', role: 'close' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '显示',
      submenu: [
        { label: '重新载入', role: 'reload' },
        { label: '切换开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '缩放', role: 'zoom' },
        { label: '前置全部窗口', role: 'front' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const preferenceSnapshot =
    applicationPreferences?.current() ?? structuredClone(defaultApplicationPreferences)
  const placement = resolveWindowPlacement(
    preferenceSnapshot,
    screen.getAllDisplays().map(({ workArea }) => workArea),
  )
  const window = new BrowserWindow({
    width: placement.width,
    height: placement.height,
    ...(placement.x === undefined ? {} : { x: placement.x }),
    ...(placement.y === undefined ? {} : { y: placement.y }),
    minWidth: 900,
    minHeight: 620,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f3f5f8',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      preload: path.join(currentDirectory, '../preload/index.cjs'),
    },
  })

  const removeWebContentsHardening = hardenWebContents(window.webContents)
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  const persistWindow = () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = undefined
    if (!window.isDestroyed()) {
      try {
        applicationPreferences?.updateWindow(window.getNormalBounds(), window.isMaximized())
      } catch {
        console.warn('无法保存窗口偏好，当前窗口继续可用。')
      }
    }
  }
  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistWindow, 200)
  }
  window.on('resize', schedulePersist)
  window.on('move', schedulePersist)
  window.on('maximize', schedulePersist)
  window.on('unmaximize', schedulePersist)
  window.once('close', persistWindow)
  window.once('closed', () => {
    if (persistTimer) clearTimeout(persistTimer)
    removeWebContentsHardening()
  })
  window.once('ready-to-show', () => {
    if (placement.maximized) window.maximize()
    window.show()
  })
  const captureView = process.env.STUDIO_CAPTURE_VIEW
  void window
    .loadFile(
      path.join(currentDirectory, '../renderer/index.html'),
      captureView ? { hash: captureView } : undefined,
    )
    .catch(() => {
      console.error('Agent Stack Studio 无法载入 Renderer。')
      app.quit()
    })
  return window
}

async function bootstrap(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Agent Stack Studio 目前仅支持 macOS。')
  }

  const launchOptions = parseLaunchOptions(process.argv)
  removeSessionHardening = hardenSession(session.defaultSession)

  const userData = app.getPath('userData')
  const databasePath = path.join(userData, 'studio.sqlite3')
  const workspacesPath = path.join(userData, 'workspaces')
  const artifactsPath = path.join(userData, 'artifacts')
  const maintenance = new DataMaintenanceService({
    applicationVersion: app.getVersion(),
    packaged: app.isPackaged,
    paths: {
      userData,
      database: databasePath,
      workspaces: workspacesPath,
      artifacts: artifactsPath,
    },
  })
  await maintenance.applyPendingRestore()
  const logger = new AppLogger(path.join(userData, 'logs'))
  repository = new AgentRepository(databasePath)
  componentRepository = new ComponentRepository(databasePath)
  const portableMigration = await migrateLegacyPortableFacts({
    agents: repository,
    components: componentRepository,
    workspacesRoot: workspacesPath,
  })
  if (portableMigration.failed.length) {
    throw new Error(
      `历史便携事实迁移未完成：${portableMigration.failed
        .map(({ agentId, message }) => `${agentId}: ${message}`)
        .join('；')}`,
    )
  }
  runRepository = new RunRepository(databasePath)
  experimentRepository = new ExperimentRepository(databasePath)
  publishRepository = new PublishRepository(databasePath)
  projectIndexRepository = new ProjectIndexRepository(databasePath)
  applicationPreferences = new ApplicationPreferencesService(projectIndexRepository)
  const components = new ComponentService(componentRepository)
  const agents = new AgentService(repository, new WorkspaceService(workspacesPath))
  const componentCatalog = new ComponentCatalogService({ agents, components })
  const unregisterSecretIpc = registerSecretIpc({
    secrets: new SecretService({ repository, keychain: new MacOsKeychainAdapter() }),
    prompt: new MacOsSecureInputPrompt(),
  })
  const unregisterComponentIpc = registerComponentIpc({
    components,
    catalog: componentCatalog,
  })
  runtime = new RuntimeController(path.join(currentDirectory, '../runtime/index.mjs'), logger)
  const runs = new RunService({
    agents,
    components,
    repository: runRepository,
    runtime,
    artifacts: new ArtifactService(artifactsPath),
    electronVersion: process.versions.electron,
    architecture: process.arch,
  })
  const experiments = new ExperimentService({
    agents,
    components,
    runs,
    repository: experimentRepository,
    architecture: process.arch,
    electronVersion: process.versions.electron,
  })
  experimentService = experiments
  const unregisterRunIpc = registerRunIpc({
    runs,
    history: new RunHistoryService({ runs, experiments }),
  })
  const unregisterExperimentIpc = registerExperimentIpc({
    experiments,
    getWindow: () => mainWindow,
  })
  const publishing = new PublishService({
    agents,
    components,
    runs,
    repository: publishRepository,
    publisher: new MulticaContractTestPublisher(),
  })
  const unregisterPublishIpc = registerPublishIpc(publishing)
  const agentStatus = new AgentStatusService({
    agents,
    stacks: components,
    runs,
    experiments,
    publishing,
  })
  const unregisterAgentIpc = registerAgentIpc({
    agents,
    agentStatus,
    imports: new ImportService(),
    getWindow: () => mainWindow,
  })
  const unregisterMaintenanceIpc = registerMaintenanceIpc({
    maintenance,
    getWindow: () => mainWindow,
    scheduleRestart: () => {
      app.relaunch()
      app.quit()
    },
  })
  const cliPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked/dist/cli/studio.mjs')
    : path.join(currentDirectory, '../cli/studio.mjs')
  studioProjectService = new StudioProjectService({
    index: projectIndexRepository,
    components,
    agents: repository,
    cliPath,
    compatibilityRuntime: new ChildProcessCompatibilityRuntime(
      path.join(currentDirectory, '../runtime/compatibility-validation.mjs'),
    ),
  })
  components.connectProject(studioProjectService)
  agents.connectProject(studioProjectService)
  componentCatalog.connectProject(studioProjectService)
  if (launchOptions.projectPath) await studioProjectService.open(launchOptions.projectPath)
  const unregisterStudioProjectIpc = registerStudioProjectIpc({
    projects: studioProjectService,
    getWindow: () => mainWindow,
    selectExportDestination:
      process.env.STUDIO_PACKAGED_E2E === '1' && process.env.STUDIO_E2E_PROJECT_EXPORT_PATH
        ? () => Promise.resolve(path.resolve(process.env.STUDIO_E2E_PROJECT_EXPORT_PATH!))
        : undefined,
  })
  discoveryService = new DiscoveryService({
    provider: new GithubDiscoveryProvider({
      fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
    }),
  })
  const unregisterDiscoveryIpc = registerDiscoveryIpc(discoveryService)
  const unregisterPreferencesIpc = registerPreferencesIpc(applicationPreferences)
  const unregisterCommandCenterIpc = registerCommandCenterIpc(
    new CommandCenterService({
      projects: studioProjectService,
      agents: agentStatus,
      components: componentCatalog,
      runs,
      experiments,
    }),
  )
  unregisterIpc = () => {
    unregisterAgentIpc()
    unregisterSecretIpc()
    unregisterComponentIpc()
    unregisterRunIpc()
    unregisterExperimentIpc()
    unregisterPublishIpc()
    unregisterMaintenanceIpc()
    unregisterStudioProjectIpc()
    unregisterDiscoveryIpc()
    unregisterPreferencesIpc()
    unregisterCommandCenterIpc()
  }

  createApplicationMenu()
  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })

  const capturePath = process.env.STUDIO_CAPTURE_PATH
  if (capturePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(
        () => {
          void mainWindow?.webContents
            .capturePage()
            .then((image) => writeFile(capturePath, image.toPNG()))
            .catch(() => console.error('无法生成本地验收截图。'))
            .finally(() => app.quit())
        },
        Number(process.env.STUDIO_CAPTURE_DELAY_MS ?? 1_000),
      )
    })
  } else if (process.env.STUDIO_SMOKE_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(() => app.quit(), 250))
  }
}

if (ownsSingleInstanceLock) {
  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error(sanitizedErrorMessage(error, 'Agent Stack Studio 启动失败。'))
      app.exit(1)
    })
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
})

app.on('before-quit', (event) => {
  if (!runtime) return
  event.preventDefault()
  const currentRuntime = runtime
  const currentExperiments = experimentService
  runtime = undefined
  experimentService = undefined
  void (async () => {
    await currentExperiments?.stopAll()
    await currentRuntime.stopAll()
  })()
    .catch(() => console.warn('退出时本地 Runtime 清理未完整结束。'))
    .finally(() => app.quit())
})

app.on('will-quit', () => {
  removeSessionHardening?.()
  unregisterIpc?.()
  repository?.close()
  componentRepository?.close()
  runRepository?.close()
  experimentRepository?.close()
  publishRepository?.close()
  studioProjectService?.close()
  discoveryService?.close()
  projectIndexRepository?.close()
  applicationPreferences = undefined
})
