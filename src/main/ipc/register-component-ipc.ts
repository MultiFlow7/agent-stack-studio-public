import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  addStackComponentInputSchema,
  componentListSchema,
  removeStackComponentInputSchema,
  selectCapabilityOwnerInputSchema,
} from '../../shared/component'
import { componentCatalogItemSchema, componentCatalogSchema } from '../../shared/component-catalog'
import { ipcChannels } from '../../shared/ipc'
import { stackStateSchema } from '../../shared/runtime-plan'
import type { ComponentService } from '../components/component-service'
import type { ComponentCatalogService } from '../components/component-catalog-service'
import { createValidatedHandler } from './validated-handler'

const agentIdInputSchema = z.object({ id: z.uuid() }).strict()

export function registerComponentIpc(options: {
  components: ComponentService
  catalog: ComponentCatalogService
}): () => void {
  const { components, catalog } = options
  ipcMain.handle(
    ipcChannels.componentsCatalog,
    createValidatedHandler({
      input: z.undefined(),
      output: componentCatalogSchema,
      handle: () => catalog.list(),
    }),
  )
  ipcMain.handle(
    ipcChannels.componentsGet,
    createValidatedHandler({
      input: z.object({ id: z.uuid() }).strict(),
      output: componentCatalogItemSchema,
      handle: ({ id }) => catalog.get(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.componentsList,
    createValidatedHandler({
      input: z.undefined(),
      output: componentListSchema,
      handle: () => components.list(),
    }),
  )
  ipcMain.handle(
    ipcChannels.stackComponentsGet,
    createValidatedHandler({
      input: agentIdInputSchema,
      output: stackStateSchema,
      handle: ({ id }) => components.getStack(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.stackComponentsAdd,
    createValidatedHandler({
      input: addStackComponentInputSchema,
      output: stackStateSchema,
      handle: (input) => components.addToStack(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.stackComponentsRemove,
    createValidatedHandler({
      input: removeStackComponentInputSchema,
      output: stackStateSchema,
      handle: (input) => components.removeFromStack(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.stackOwnersSelect,
    createValidatedHandler({
      input: selectCapabilityOwnerInputSchema,
      output: stackStateSchema,
      handle: (input) => components.selectOwner(input),
    }),
  )

  return () => {
    for (const channel of [
      ipcChannels.componentsList,
      ipcChannels.componentsCatalog,
      ipcChannels.componentsGet,
      ipcChannels.stackComponentsGet,
      ipcChannels.stackComponentsAdd,
      ipcChannels.stackComponentsRemove,
      ipcChannels.stackOwnersSelect,
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
