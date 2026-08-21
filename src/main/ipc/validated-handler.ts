import type { IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'
import { AppError, toPublicError } from '../../shared/errors'
import { StudioCoreError } from '../../core/project-errors'

export function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
  try {
    const parsed = new URL(senderUrl)
    return parsed.protocol === 'file:' && parsed.hostname === ''
  } catch {
    return false
  }
}

export function createValidatedHandler<TInput, TOutput>(options: {
  input: ZodType<TInput>
  output: ZodType<TOutput>
  handle: (input: TInput, event: IpcMainInvokeEvent) => TOutput | Promise<TOutput>
}): (event: IpcMainInvokeEvent, input: unknown) => Promise<TOutput> {
  return async (event, input) => {
    if (!isTrustedIpcSender(event)) {
      throw toPublicError(new AppError('VALIDATION_FAILED', '请求来源不受信任。'))
    }

    const parsedInput = options.input.safeParse(input)
    if (!parsedInput.success) {
      throw toPublicError(
        new AppError('VALIDATION_FAILED', '提交的 Agent 数据无效。', {
          cause: parsedInput.error,
        }),
      )
    }

    try {
      const output = await options.handle(parsedInput.data, event)
      return options.output.parse(output)
    } catch (error) {
      if (error instanceof StudioCoreError) throw new Error(error.message)
      throw toPublicError(error)
    }
  }
}
