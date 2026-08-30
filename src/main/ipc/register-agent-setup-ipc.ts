import { ipcMain } from 'electron'
import { z } from 'zod'
import type { SecureInputPrompt } from '../../adapters/keychain/macos-secure-input'
import {
  agentSetupActionResultSchema,
  agentSetupCancelInputSchema,
  agentSetupCancelResultSchema,
  agentSetupCompleteResultSchema,
  agentSetupDiscardResultSchema,
  agentSetupIdInputSchema,
  agentSetupListSchema,
  agentSetupSaveInputSchema,
  agentSetupUpdateInputSchema,
  agentSetupVerifyInputSchema,
  agentSetupViewSchema,
} from '../../shared/agent-setup'
import { ipcChannels } from '../../shared/ipc'
import { mcpValidationInputSchema } from '../../shared/mcp'
import type { AgentSetupService } from '../agents/agent-setup-service'
import { createValidatedHandler } from './validated-handler'

const emptyInputSchema = z.object({}).strict()

export function registerAgentSetupIpc(options: {
  setups: AgentSetupService
  prompt: SecureInputPrompt
}): () => void {
  let configureInFlight: Promise<unknown> | undefined

  ipcMain.handle(
    ipcChannels.agentSetupStart,
    createValidatedHandler({
      input: emptyInputSchema,
      output: agentSetupViewSchema,
      handle: () => options.setups.start(),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupList,
    createValidatedHandler({
      input: emptyInputSchema,
      output: agentSetupListSchema,
      handle: () => options.setups.list(),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupGet,
    createValidatedHandler({
      input: agentSetupIdInputSchema,
      output: agentSetupViewSchema,
      handle: ({ id }) => options.setups.get(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupUpdate,
    createValidatedHandler({
      input: agentSetupUpdateInputSchema,
      output: agentSetupViewSchema,
      handle: (input) => options.setups.update(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupSave,
    createValidatedHandler({
      input: agentSetupSaveInputSchema,
      output: agentSetupViewSchema,
      handle: ({ id, expectedRevision }) => options.setups.save(id, expectedRevision),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupDiscard,
    createValidatedHandler({
      input: agentSetupIdInputSchema,
      output: agentSetupDiscardResultSchema,
      handle: ({ id }) => options.setups.discard(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupConfigureApiKey,
    createValidatedHandler({
      input: agentSetupIdInputSchema,
      output: agentSetupActionResultSchema,
      handle: async ({ id }) => {
        if (configureInFlight) return configureInFlight
        const task = (async () => {
          const view = await options.setups.get(id)
          const secret = await options.prompt.request(
            `${view.session.selection?.providerId ?? '模型 Provider'} API Key`,
            view.session.selection?.providerId ?? 'model-provider',
          )
          if (secret === null) {
            return { status: 'cancelled' as const, view: await options.setups.get(id) }
          }
          return {
            status: 'completed' as const,
            view: await options.setups.configureApiKey(id, secret),
          }
        })().finally(() => {
          if (configureInFlight === task) configureInFlight = undefined
        })
        configureInFlight = task
        return task
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupLaunchLogin,
    createValidatedHandler({
      input: agentSetupIdInputSchema,
      output: agentSetupActionResultSchema,
      handle: async ({ id }) => ({
        status: 'launched' as const,
        view: await options.setups.launchOfficialLogin(id),
      }),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupRefreshAuth,
    createValidatedHandler({
      input: agentSetupIdInputSchema,
      output: agentSetupViewSchema,
      handle: ({ id }) => options.setups.refreshAuthentication(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupVerify,
    createValidatedHandler({
      input: agentSetupVerifyInputSchema,
      output: agentSetupActionResultSchema,
      handle: async (input) => ({
        status: 'completed' as const,
        view: await options.setups.verify(input),
      }),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupCancel,
    createValidatedHandler({
      input: agentSetupCancelInputSchema,
      output: agentSetupCancelResultSchema,
      handle: ({ requestId }) => ({ cancelled: options.setups.cancel(requestId) }),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupValidateMcp,
    createValidatedHandler({
      input: mcpValidationInputSchema,
      output: agentSetupViewSchema,
      handle: (input) => options.setups.validateMcp(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentSetupComplete,
    createValidatedHandler({
      input: agentSetupIdInputSchema,
      output: agentSetupCompleteResultSchema,
      handle: ({ id }) => options.setups.complete(id),
    }),
  )

  return () => {
    configureInFlight = undefined
    options.setups.close()
    for (const channel of [
      ipcChannels.agentSetupStart,
      ipcChannels.agentSetupList,
      ipcChannels.agentSetupGet,
      ipcChannels.agentSetupUpdate,
      ipcChannels.agentSetupSave,
      ipcChannels.agentSetupDiscard,
      ipcChannels.agentSetupConfigureApiKey,
      ipcChannels.agentSetupLaunchLogin,
      ipcChannels.agentSetupRefreshAuth,
      ipcChannels.agentSetupVerify,
      ipcChannels.agentSetupCancel,
      ipcChannels.agentSetupValidateMcp,
      ipcChannels.agentSetupComplete,
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
