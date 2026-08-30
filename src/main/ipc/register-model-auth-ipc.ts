import { ipcMain } from 'electron'
import type { SecureInputPrompt } from '../../adapters/keychain/macos-secure-input'
import { ipcChannels } from '../../shared/ipc'
import {
  modelAuthActionResultSchema,
  modelAuthCancelInputSchema,
  modelAuthCancelResultSchema,
  modelAuthEmptyInputSchema,
  modelAuthSelectInputSchema,
  modelAuthVerifyInputSchema,
  modelAuthViewSchema,
  type ModelAuthSelectInput,
  type ModelAuthVerifyInput,
  type ModelAuthView,
} from '../../shared/model-auth-ipc'
import { createValidatedHandler } from './validated-handler'

export interface ModelAuthIpcService {
  view(): Promise<ModelAuthView>
  select(input: ModelAuthSelectInput): Promise<ModelAuthView>
  configureApiKey(secret: string): Promise<ModelAuthView>
  launchOfficialLogin(): Promise<ModelAuthView>
  refreshAuthentication(options?: { signal?: AbortSignal }): Promise<ModelAuthView>
  verify(input: ModelAuthVerifyInput, options?: { signal?: AbortSignal }): Promise<ModelAuthView>
}

export function registerModelAuthIpc(options: {
  modelAuth: ModelAuthIpcService
  prompt: SecureInputPrompt
}): () => void {
  const controllers = new Map<string, AbortController>()
  let promptQueue: Promise<void> = Promise.resolve()
  let configureInFlight: Promise<unknown> | undefined

  const enqueuePrompt = <T>(action: () => Promise<T>): Promise<T> => {
    const task = promptQueue.catch(() => undefined).then(action)
    promptQueue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  ipcMain.handle(
    ipcChannels.modelAuthStatus,
    createValidatedHandler({
      input: modelAuthEmptyInputSchema,
      output: modelAuthViewSchema,
      handle: () => options.modelAuth.view(),
    }),
  )
  ipcMain.handle(
    ipcChannels.modelAuthSelect,
    createValidatedHandler({
      input: modelAuthSelectInputSchema,
      output: modelAuthViewSchema,
      handle: (input) => options.modelAuth.select(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.modelAuthConfigureApiKey,
    createValidatedHandler({
      input: modelAuthEmptyInputSchema,
      output: modelAuthActionResultSchema,
      handle: async () => {
        if (configureInFlight) return configureInFlight
        const task = enqueuePrompt(async () => {
          const current = await options.modelAuth.view()
          const provider = current.capability?.providers.find(
            ({ id }) => id === current.selection?.providerId,
          )
          const secret = await options.prompt.request(
            `${provider?.label ?? '模型 Provider'} API Key`,
            provider?.id ?? 'model-provider',
          )
          if (secret === null) {
            return modelAuthActionResultSchema.parse({
              status: 'cancelled',
              view: await options.modelAuth.view(),
            })
          }
          return modelAuthActionResultSchema.parse({
            status: 'completed',
            view: await options.modelAuth.configureApiKey(secret),
          })
        }).finally(() => {
          if (configureInFlight === task) configureInFlight = undefined
        })
        configureInFlight = task
        return task
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.modelAuthLaunchLogin,
    createValidatedHandler({
      input: modelAuthEmptyInputSchema,
      output: modelAuthActionResultSchema,
      handle: async () => ({
        status: 'launched' as const,
        view: await options.modelAuth.launchOfficialLogin(),
      }),
    }),
  )
  ipcMain.handle(
    ipcChannels.modelAuthRefresh,
    createValidatedHandler({
      input: modelAuthEmptyInputSchema,
      output: modelAuthViewSchema,
      handle: () => options.modelAuth.refreshAuthentication(),
    }),
  )
  ipcMain.handle(
    ipcChannels.modelAuthVerify,
    createValidatedHandler({
      input: modelAuthVerifyInputSchema,
      output: modelAuthActionResultSchema,
      handle: async (input) => {
        if (controllers.has(input.requestId)) {
          throw new Error('该模型验证请求已在执行。')
        }
        const controller = new AbortController()
        controllers.set(input.requestId, controller)
        try {
          const view = await options.modelAuth.verify(input, { signal: controller.signal })
          return { status: controller.signal.aborted ? 'cancelled' : 'completed', view }
        } finally {
          controllers.delete(input.requestId)
        }
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.modelAuthCancel,
    createValidatedHandler({
      input: modelAuthCancelInputSchema,
      output: modelAuthCancelResultSchema,
      handle: ({ requestId }) => {
        const controller = controllers.get(requestId)
        if (!controller || controller.signal.aborted) return { cancelled: false }
        controller.abort()
        return { cancelled: true }
      },
    }),
  )

  return () => {
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    configureInFlight = undefined
    for (const channel of [
      ipcChannels.modelAuthStatus,
      ipcChannels.modelAuthSelect,
      ipcChannels.modelAuthConfigureApiKey,
      ipcChannels.modelAuthLaunchLogin,
      ipcChannels.modelAuthRefresh,
      ipcChannels.modelAuthVerify,
      ipcChannels.modelAuthCancel,
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
