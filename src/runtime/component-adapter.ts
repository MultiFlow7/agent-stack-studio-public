import { z } from 'zod'

const adapterIdentitySchema = z
  .object({
    serviceKey: z.string().trim().min(1),
    componentContractId: z.string().trim().min(1),
    componentVersion: z.string().trim().min(1),
  })
  .strict()

export interface RuntimeComponentAdapter {
  readonly serviceKey: string
  readonly componentContractId: string
  readonly componentVersion: string
  start(): Promise<void>
  stop(): Promise<void>
}

export function defineRuntimeAdapter(
  identity: z.input<typeof adapterIdentitySchema>,
  lifecycle: Pick<RuntimeComponentAdapter, 'start' | 'stop'>,
): RuntimeComponentAdapter {
  const parsed = adapterIdentitySchema.parse(identity)
  return { ...parsed, start: lifecycle.start, stop: lifecycle.stop }
}
