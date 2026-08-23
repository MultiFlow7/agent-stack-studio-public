import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import {
  multicaCliTargetId,
  publishPackageSchema,
  publishReceiptSchema,
  publishTargetSchema,
  type PublishPreview,
} from '../../../shared/publish'
import { createRunFixture } from '../../../test/run-fixture'
import { PublishPanel } from './PublishPanel'

const multicaTarget = publishTargetSchema.parse({
  id: multicaCliTargetId,
  connector: 'multica',
  transport: 'cli',
  label: 'Multica',
  description: '真实发布。',
  availability: 'ready',
  externalSideEffect: true,
})

function fixtures(status: 'ready' | 'blocked' = 'ready') {
  const { version } = createRunFixture()
  const publishPackage = publishPackageSchema.parse({
    packageVersion: 1,
    source: {
      studioVersion: '0.1.0',
      localAgentId: version.agentId,
      agentVersionId: version.id,
      agentVersionNumber: version.versionNumber,
      agentVersionHash: version.contentHash,
    },
    agent: {
      name: version.snapshot.agent.name,
      description: version.snapshot.agent.description,
      executionMode: version.snapshot.agent.executionMode,
    },
    harness: { id: 'openclaw', contractId: 'studio.harness.openclaw', version: '2026.1.30' },
    stack: {
      revision: version.snapshot.stack.revision,
      components: [
        {
          contractId: 'studio.sample.harness-x',
          version: '1.0.0',
          capabilities: ['execution-controller'],
          runtimeRequired: true,
        },
      ],
      capabilityOwners: [],
    },
    environmentDeclarations: [],
    requirements: {
      platforms: ['darwin-arm64', 'darwin-x64'],
      cordisVersion: '4.0.0-rc.8',
      network: 'denied',
    },
    excludedContent: [
      'local-paths',
      'keychain-secrets',
      'experiment-data',
      'chat-history',
      'run-logs',
      'artifacts',
    ],
    contentHash: 'b'.repeat(64),
  })
  const preview: PublishPreview = {
    target: multicaTarget,
    package: publishPackage,
    validation: {
      status,
      issues:
        status === 'ready'
          ? [
              {
                field: 'target',
                severity: 'warning',
                code: 'CAPABILITY_DEGRADED',
                message: '工具权限由 Runtime 管理。',
              },
            ]
          : [
              {
                field: 'agentVersion.verification',
                severity: 'blocking',
                code: 'VERSION_NOT_VERIFIED',
                message: '所选版本还没有成功的本地 Run。',
              },
            ],
      checkedAt: '2026-08-19T12:00:00.000Z',
    },
    priorReceipt: null,
  }
  const receipt = publishReceiptSchema.parse({
    id: '50000000-0000-4000-8000-000000000001',
    targetId: multicaCliTargetId,
    agentId: version.agentId,
    agentVersionId: version.id,
    packageHash: publishPackage.contentHash,
    idempotencyKey: 'c'.repeat(64),
    attempt: 1,
    status: 'succeeded',
    remoteAgentId: 'test-agent-1',
    remoteVersionId: 'test-version-1',
    response: { message: '远端确认。', publishedFields: ['agent'], testOnly: false },
    failure: null,
    createdAt: '2026-08-19T12:01:00.000Z',
    completedAt: '2026-08-19T12:01:01.000Z',
  })
  return { version, preview, receipt }
}

function installApi(preview: PublishPreview, receipt = fixtures().receipt) {
  const publish = vi.fn(() => Promise.resolve({ receipt, reused: false }))
  const history = vi
    .fn()
    .mockResolvedValueOnce({ mapping: null, receipts: [] })
    .mockResolvedValue({
      mapping: {
        targetId: multicaCliTargetId,
        agentId: receipt.agentId,
        remoteAgentId: receipt.remoteAgentId!,
        createdAt: receipt.createdAt,
        updatedAt: receipt.completedAt!,
      },
      receipts: [receipt],
    })
  window.studio = {
    publishing: {
      runtimes: vi.fn(() =>
        Promise.resolve([
          {
            id: '70000000-0000-4000-8000-000000000001',
            label: 'OpenClaw on Mac',
            provider: 'openclaw',
            status: 'online',
          },
        ]),
      ),
      targets: vi.fn(() => Promise.resolve([multicaTarget])),
      preview: vi.fn(() => Promise.resolve(preview)),
      publish,
      history,
      status: vi.fn(() =>
        Promise.resolve({
          state: 'not-published' as const,
          remoteAgentId: null,
          localContentHash: preview.package.contentHash,
          remoteContentHash: null,
          displayName: null,
          checkedAt: '2026-08-19T12:00:00.000Z',
          message: '尚未发布。',
        }),
      ),
    },
  } as unknown as StudioApi
  return { publish }
}

describe('PublishPanel', () => {
  it('requires explicit confirmation and publishes from the keyboard', async () => {
    const { version, preview, receipt } = fixtures()
    const { publish } = installApi(preview, receipt)
    const user = userEvent.setup()
    render(<PublishPanel agentId={version.agentId} version={version} />)

    expect(await screen.findByText('发布预检通过')).toBeVisible()
    const publishButton = screen.getByRole('button', { name: '发布此版本到 Multica' })
    expect(publishButton).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /我已检查发布范围/ }))
    publishButton.focus()
    await user.keyboard('{Enter}')

    expect(publish).toHaveBeenCalledWith({
      targetId: multicaCliTargetId,
      agentId: version.agentId,
      agentVersionId: version.id,
      runtimeId: '70000000-0000-4000-8000-000000000001',
      confirmed: true,
    })
    expect(await screen.findByText('Multica 已确认接收该冻结版本。')).toBeVisible()
    expect(await screen.findByText('已成功')).toBeVisible()
  })

  it('keeps the publish action disabled when verification is blocked', async () => {
    const { version, preview } = fixtures('blocked')
    installApi(preview)
    render(<PublishPanel agentId={version.agentId} version={version} />)

    expect(await screen.findByText('发布已阻断')).toBeVisible()
    expect(screen.getByText('所选版本还没有成功的本地 Run。')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: /我已检查发布范围/ })).toBeDisabled()
  })
})
