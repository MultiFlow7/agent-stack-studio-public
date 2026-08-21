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
      handle: async (input) => {
        const secret = await options.prompt.request(input.label, input.keychainAccount)
        if (secret === null) return { status: 'cancelled' as const }
        return {
          status: 'configured' as const,
          reference: await options.secrets.configure({ ...input, secret }),
        }
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.secretsDelete,
    createValidatedHandler({
      input: deleteAgentSecretInputSchema,
      output: deleteAgentSecretResultSchema,
      handle: ({ referenceId }) => options.secrets.delete(referenceId),
    }),
  )

  return () => {
    for (const channel of [
      ipcChannels.secretsList,
      ipcChannels.secretsConfigure,
      ipcChannels.secretsDelete,
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
