import { z } from 'zod'

export const appViewSchema = z.enum([
  'project',
  'discovery',
  'agents',
  'components',
  'experiments',
  'runs',
  'settings',
])

export type AppView = z.infer<typeof appViewSchema>

export const rendererPreferencesSchema = z.object({
  sidebarCollapsed: z.boolean(),
  lastView: appViewSchema,
})

export type RendererPreferences = z.infer<typeof rendererPreferencesSchema>

export const updateRendererPreferencesInputSchema = rendererPreferencesSchema.strict()

export const windowPreferenceSchema = z.object({
  x: z.number().int().nullable(),
  y: z.number().int().nullable(),
  width: z.number().int().min(900).max(10_000),
  height: z.number().int().min(620).max(10_000),
  maximized: z.boolean(),
})

export type WindowPreference = z.infer<typeof windowPreferenceSchema>

export const applicationPreferencesSchema = z.object({
  contractVersion: z.literal(1),
  renderer: rendererPreferencesSchema,
  window: windowPreferenceSchema,
})

export type ApplicationPreferences = z.infer<typeof applicationPreferencesSchema>

export const defaultApplicationPreferences: ApplicationPreferences = {
  contractVersion: 1,
  renderer: { sidebarCollapsed: false, lastView: 'agents' },
  window: { x: null, y: null, width: 1180, height: 760, maximized: false },
}
