import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import type { SecretReferenceStatus } from '../../../shared/secret-reference'
import { SecretReferencesPanel } from './SecretReferencesPanel'

const agentId = '4061fbad-2152-47bc-9db3-bd70d133f2be'
const referenceId = '79f5c495-443c-4e88-8332-a761f07519b7'

function installApi(initial: SecretReferenceStatus[] = []) {
  let references = initial
  const list = vi.fn<StudioApi['secrets']['list']>(() => Promise.resolve(references))
  const configure = vi.fn<StudioApi['secrets']['configure']>((input) => {
    const result: SecretReferenceStatus = {
      id: referenceId,
      agentId,
      label: input.label,
      keychainService: 'studio.agentstack.desktop',
      keychainAccount: input.keychainAccount,
      createdAt: '2026-08-20T08:00:00.000Z',
      configured: true,
    }
    references = [result]
    return Promise.resolve({ status: 'configured' as const, reference: result })
  })
  const remove = vi.fn<StudioApi['secrets']['delete']>(({ referenceId: id }) => {
    references = references.filter(({ id: itemId }) => itemId !== id)
    return Promise.resolve({ referenceId: id, deleted: true })
  })
  window.studio = { secrets: { list, configure, delete: remove } } as unknown as StudioApi
  return { list, configure, remove }
}

describe('SecretReferencesPanel', () => {
  beforeEach(() => installApi())

  it('opens native secure input without accepting a secret in Renderer state', async () => {
    const { configure } = installApi()
    const user = userEvent.setup()
    render(<SecretReferencesPanel agentId={agentId} />)

    expect(await screen.findByText('尚未配置密钥')).toBeVisible()
    await user.type(screen.getByLabelText('用途名称'), 'OpenAI API')
    await user.type(screen.getByLabelText('账户标识'), 'openai-api')
    expect(screen.queryByLabelText('密钥原文')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '打开安全输入并写入' }))

    await waitFor(() => expect(configure).toHaveBeenCalledTimes(1))
    expect(configure).toHaveBeenCalledWith({
      agentId,
      label: 'OpenAI API',
      keychainAccount: 'openai-api',
    })
    expect(await screen.findByText('已配置')).toBeVisible()
  })

  it('shows restored missing status and requires inline delete confirmation', async () => {
    const reference: SecretReferenceStatus = {
      id: referenceId,
      agentId,
      label: 'Restored API',
      keychainService: 'studio.agentstack.desktop',
      keychainAccount: 'restored-api',
      createdAt: '2026-08-20T08:00:00.000Z',
      configured: false,
    }
    const { remove } = installApi([reference])
    const user = userEvent.setup()
    render(<SecretReferencesPanel agentId={agentId} />)

    expect(await screen.findByText('本机缺失')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '移除 Restored API' }))
    expect(screen.getByRole('button', { name: '确认移除' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '移除 Restored API' }))
    await user.click(screen.getByRole('button', { name: '确认移除' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith({ referenceId }))
    expect(screen.queryByText('Restored API')).not.toBeInTheDocument()
  })

  it('keeps metadata available when native secure input is cancelled', async () => {
    const { configure } = installApi()
    configure.mockResolvedValueOnce({ status: 'cancelled' })
    const user = userEvent.setup()
    render(<SecretReferencesPanel agentId={agentId} />)

    await screen.findByText('尚未配置密钥')
    await user.type(screen.getByLabelText('用途名称'), 'Cancelled API')
    await user.type(screen.getByLabelText('账户标识'), 'cancelled-api')
    await user.click(screen.getByRole('button', { name: '打开安全输入并写入' }))

    expect(await screen.findByText('已取消，未写入钥匙串。')).toBeVisible()
    expect(screen.getByDisplayValue('Cancelled API')).toBeVisible()
    expect(screen.getByDisplayValue('cancelled-api')).toBeVisible()
  })
})
