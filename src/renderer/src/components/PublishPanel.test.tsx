import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import {
  localContractTestTargetId,
  publishPackageSchema,
  publishReceiptSchema,
  publishTargetSchema,
  type PublishPreview,
} from '../../../shared/publish'
import { createRunFixture } from '../../../test/run-fixture'
import { PublishPanel } from './PublishPanel'

const localTarget = publishTargetSchema.parse({
  id: localContractTestTargetId,
  connector: 'multica',
  transport: 'contract-test',
  label: '本地 Contract Test Target',
  description: '不发起网络请求。',
  availability: 'ready',
  externalSideEffect: false,
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
      'run-logs',
      'artifacts',
    ],
    contentHash: 'b'.repeat(64),
  })
  const preview: PublishPreview = {
    target: localTarget,
    package: publishPackage,
    validation: {
      status,
      issues:
        status === 'ready'
          ? [
              {
                field: 'target',
                severity: 'warning',
                code: 'LOCAL_TEST_ONLY',
                message: '当前目标不发起网络请求。',
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
    targetId: localContractTestTargetId,
    agentId: version.agentId,
    agentVersionId: version.id,
    packageHash: publishPackage.contentHash,
    idempotencyKey: 'c'.repeat(64),
    attempt: 1,
    status: 'succeeded',
    remoteAgentId: 'test-agent-1',
    remoteVersionId: 'test-version-1',
    response: { message: '契约通过。', publishedFields: ['agent'], testOnly: true },
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
        targetId: localContractTestTargetId,
        agentId: receipt.agentId,
        remoteAgentId: receipt.remoteAgentId!,
        createdAt: receipt.createdAt,
        updatedAt: receipt.completedAt!,
      },
      receipts: [receipt],
    })
  window.studio = {
    publishing: {
      targets: vi.fn(() => Promise.resolve([localTarget])),
      preview: vi.fn(() => Promise.resolve(preview)),
      publish,
      history,
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
    const publishButton = screen.getByRole('button', { name: '发布此版本到本地测试目标' })
    expect(publishButton).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /我已检查发布范围/ }))
    publishButton.focus()
    await user.keyboard('{Enter}')

    expect(publish).toHaveBeenCalledWith({
      targetId: localContractTestTargetId,
      agentId: version.agentId,
      agentVersionId: version.id,
      confirmed: true,
    })
    expect(await screen.findByText('发布包已通过本地 Connector Contract Test。')).toBeVisible()
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
