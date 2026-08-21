import { z } from 'zod'
import { runStatusSchema } from './run'
import { appViewSchema } from './preferences'

export const commandCenterWorkspaceStatusSchema = z.enum([
  'empty',
  'ready',
  'blocked',
  'changed-externally',
])
export const commandCenterActivityStatusSchema = z.enum(['idle', 'active', 'attention', 'complete'])

export const commandCenterSnapshotSchema = z
  .object({
    workspace: z
      .object({
        status: commandCenterWorkspaceStatusSchema,
        name: z.string().min(1).max(100).nullable(),
        revision: z.number().int().nonnegative().nullable(),
        issueCount: z.number().int().nonnegative(),
      })
      .strict(),
    activity: z
      .object({
        status: commandCenterActivityStatusSchema,
        activeRunCount: z.number().int().nonnegative(),
        latestRun: z
          .object({
            id: z.uuid(),
            agentId: z.uuid(),
            status: runStatusSchema,
            updatedAt: z.iso.datetime(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    counts: z
      .object({
        activeAgents: z.number().int().nonnegative(),
        archivedAgents: z.number().int().nonnegative(),
        components: z.number().int().nonnegative(),
        runs: z.number().int().nonnegative(),
        experiments: z.number().int().nonnegative(),
      })
      .strict(),
    refreshedAt: z.iso.datetime(),
  })
  .strict()

export const commandCenterActionSchema = z.enum([
  'create-agent',
  'import-agent',
  'open-project',
  'create-project',
  'refresh',
])

export const commandCenterDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('view'), view: appViewSchema }).strict(),
  z.object({ kind: z.literal('agent'), agentId: z.uuid() }).strict(),
  z.object({ kind: z.literal('component'), componentId: z.uuid() }).strict(),
  z.object({ kind: z.literal('run'), runId: z.uuid() }).strict(),
  z.object({ kind: z.literal('experiment'), experimentId: z.uuid() }).strict(),
  z.object({ kind: z.literal('action'), action: commandCenterActionSchema }).strict(),
])

export const commandCenterResultSchema = z
  .object({
    id: z.string().min(1).max(200),
    category: z.enum([
      'navigation',
      'action',
      'project',
      'agent',
      'component',
      'run',
      'experiment',
    ]),
    label: z.string().min(1).max(160),
    detail: z.string().min(1).max(500),
    destination: commandCenterDestinationSchema,
  })
  .strict()

export const commandCenterSearchInputSchema = z
  .object({ query: z.string().trim().max(100) })
  .strict()
export const commandCenterSearchResultSchema = z.array(commandCenterResultSchema).max(12)

export type CommandCenterSnapshot = z.infer<typeof commandCenterSnapshotSchema>
export type CommandCenterResult = z.infer<typeof commandCenterResultSchema>
export type CommandCenterSearchInput = z.infer<typeof commandCenterSearchInputSchema>
export type CommandCenterDestination = z.infer<typeof commandCenterDestinationSchema>
