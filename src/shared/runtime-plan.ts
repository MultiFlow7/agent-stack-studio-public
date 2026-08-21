import { z } from 'zod'
import { executionModeSchema } from './agent'
import { capabilityIdSchema, componentRecordSchema } from './component'
import { compatibilityRemediationTasksSchema } from './remediation'

export const capabilityOwnerSchema = z
  .object({
    capability: capabilityIdSchema,
    componentId: z.uuid(),
    selectedAt: z.iso.datetime(),
  })
  .strict()

export const runtimePlanIssueCodeSchema = z.enum([
  'EMPTY_STACK',
  'OWNER_REQUIRED',
  'OWNER_INVALID',
  'UNSATISFIED_REQUIREMENT',
  'COMPONENT_BLOCKED',
  'COMPATIBILITY_UNKNOWN',
  'ADAPTER_UNVERIFIED',
  'UNCONTROLLED_SIDE_EFFECT',
  'EXECUTION_CONTROLLER_REQUIRED',
])

export const runtimePlanIssueSchema = z
  .object({
    code: runtimePlanIssueCodeSchema,
    capability: capabilityIdSchema.nullable(),
    componentId: z.uuid().nullable(),
    message: z.string().min(1),
  })
  .strict()

export const runtimePlanServiceSchema = z
  .object({
    serviceKey: z.string().min(1),
    componentId: z.uuid(),
    componentContractId: z.string().min(1),
    componentVersion: z.string().min(1),
    adapterRef: z.string().min(1).nullable(),
    capabilities: z.array(capabilityIdSchema).min(1),
    requirements: z.array(capabilityIdSchema),
  })
  .strict()

export const runtimePlanSchema = z
  .object({
    planVersion: z.literal(1),
    agentId: z.uuid(),
    stackRevision: z.number().int().positive(),
    executionMode: executionModeSchema,
    cordisVersion: z.literal('4.0.0-rc.8'),
    services: z.array(runtimePlanServiceSchema),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const runtimePlanCompilationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      issues: z.array(runtimePlanIssueSchema).length(0),
      remediationTasks: compatibilityRemediationTasksSchema.length(0),
      plan: runtimePlanSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('blocked'),
      issues: z.array(runtimePlanIssueSchema).min(1),
      remediationTasks: compatibilityRemediationTasksSchema,
      plan: z.null(),
    })
    .strict(),
])

export const stackStateSchema = z
  .object({
    agentId: z.uuid(),
    revision: z.number().int().positive(),
    components: z.array(componentRecordSchema),
    owners: z.array(capabilityOwnerSchema),
    compilation: runtimePlanCompilationSchema,
  })
  .strict()

export type CapabilityOwner = z.infer<typeof capabilityOwnerSchema>
export type RuntimePlan = z.infer<typeof runtimePlanSchema>
export type RuntimePlanCompilation = z.infer<typeof runtimePlanCompilationSchema>
export type RuntimePlanIssue = z.infer<typeof runtimePlanIssueSchema>
export type StackState = z.infer<typeof stackStateSchema>
