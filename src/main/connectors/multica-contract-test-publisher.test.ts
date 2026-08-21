import { describe, expect, it } from 'vitest'
import { createRunFixture } from '../../test/run-fixture'
import { buildPublishPackage } from '../domain/publish-package'
import { localContractTestTargetId, publishTargetSchema } from '../../shared/publish'
import { MulticaContractTestPublisher } from './multica-contract-test-publisher'

const target = publishTargetSchema.parse({
  id: localContractTestTargetId,
  connector: 'multica',
  transport: 'contract-test',
  label: '本地测试目标',
  description: '仅用于契约测试。',
  availability: 'ready',
  externalSideEffect: false,
})

describe('MulticaContractTestPublisher', () => {
  it('validates, publishes, and inspects without network side effects', async () => {
    const { component, version } = createRunFixture()
    const publishPackage = buildPublishPackage({ version, components: [component] })
    const publisher = new MulticaContractTestPublisher()

    const validation = await publisher.validate(target, publishPackage)
    expect(validation.status).toBe('ready')
    expect(validation.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'LOCAL_TEST_ONLY' })]),
    )
    const outcome = await publisher.publish(target, publishPackage, {
      idempotencyKey: 'a'.repeat(64),
      remoteAgentId: null,
    })
    expect(outcome.testOnly).toBe(true)
    expect(await publisher.inspect(target, outcome.remoteAgentId)).toMatchObject({
      latestRemoteVersionId: outcome.remoteVersionId,
      displayName: version.snapshot.agent.name,
    })
  })
})
