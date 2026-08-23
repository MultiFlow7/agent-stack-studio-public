import { ipcMain } from 'electron'
import { z } from 'zod'
import { ipcChannels } from '../../shared/ipc'
import {
  configureAgentSecretInputSchema,
  configureAgentSecretResultSchema,
  deleteAgentSecretInputSchema,
  deleteAgentSecretResultSchema,
  secretReferenceStatusListSchema,
} from '../../shared/secret-reference'
import type { SecureInputPrompt } from '../../adapters/keychain/macos-secure-input'
import type { SecretService } from '../secrets/secret-service'
import { createValidatedHandler } from './validated-handler'

const agentIdInputSchema = z.object({ agentId: z.uuid() }).strict()

export function registerSecretIpc(options: {
  secrets: SecretService
  prompt: SecureInputPrompt
}): () => void {
  const configureInFlight = new Map<string, Promise<unknown>>()
  const deleteInFlight = new Map<string, Promise<unknown>>()
  let promptQueue: Promise<void> = Promise.resolve()

  const singleFlight = <T>(
    map: Map<string, Promise<unknown>>,
    key: string,
    action: () => Promise<T>,
  ) => {
    const existing = map.get(key) as Promise<T> | undefined
    if (existing) return existing
    const task = action().finally(() => {
      if (map.get(key) === task) map.delete(key)
    })
    map.set(key, task)
    return task
  }

  const enqueuePrompt = <T>(action: () => Promise<T>): Promise<T> => {
    const task = promptQueue.catch(() => undefined).then(action)
    promptQueue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  ipcMain.handle(
    ipcChannels.secretsList,
    createValidatedHandler({
      input: agentIdInputSchema,
      output: secretReferenceStatusListSchema,
      handle: ({ agentId }) => options.secrets.list(agentId),
    }),
  )
  ipcMain.handle(
    ipcChannels.secretsConfigure,
    createValidatedHandler({
      input: configureAgentSecretInputSchema,
      output: configureAgentSecretResultSchema,
      handle: (input) =>
        singleFlight(
          configureInFlight,
          `${input.agentId}\0${input.keychainAccount}\0${input.label}`,
          () =>
            enqueuePrompt(async () => {
              const secret = await options.prompt.request(input.label, input.keychainAccount)
              if (secret === null) return { status: 'cancelled' as const }
              return {
                status: 'configured' as const,
                reference: await options.secrets.configure({ ...input, secret }),
              }
            }),
        ),
    }),
  )
  ipcMain.handle(
    ipcChannels.secretsDelete,
    createValidatedHandler({
      input: deleteAgentSecretInputSchema,
      output: deleteAgentSecretResultSchema,
      handle: ({ referenceId }) =>
        singleFlight(deleteInFlight, referenceId, () => options.secrets.delete(referenceId)),
    }),
  )

  return () => {
    configureInFlight.clear()
    deleteInFlight.clear()
    for (const channel of [
      ipcChannels.secretsList,
      ipcChannels.secretsConfigure,
      ipcChannels.secretsDelete,
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
