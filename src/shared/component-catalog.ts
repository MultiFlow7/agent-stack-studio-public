import { z } from 'zod'
import { componentRecordSchema, validationStatusSchema } from './component'
import { compatibilityAssessmentSchema } from './compatibility-assessment'

export const componentCatalogItemSchema = z
  .object({
    component: componentRecordSchema,
    usedByAgents: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string().min(1).max(80),
          archivedAt: z.iso.datetime().nullable(),
          draftRevision: z.number().int().positive(),
        })
        .strict(),
    ),
    affectedVersions: z.array(
      z
        .object({
          agentId: z.uuid(),
          agentName: z.string().min(1).max(80),
          versionId: z.uuid(),
          versionNumber: z.number().int().positive(),
          createdAt: z.iso.datetime(),
        })
        .strict(),
    ),
    validationRecord: z
      .object({
        status: validationStatusSchema,
        recordedAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
    assessment: compatibilityAssessmentSchema.nullable().optional(),
  })
  .strict()

export const componentCatalogSchema = z.array(componentCatalogItemSchema)

export type ComponentCatalogItem = z.infer<typeof componentCatalogItemSchema>
