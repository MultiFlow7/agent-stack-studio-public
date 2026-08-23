import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRunFixture } from '../../test/run-fixture'
import { AppLogger } from '../logging/logger'
import { RuntimeController } from './runtime-controller'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('RuntimeController', () => {
  it('keeps an early cancellation request until the fresh child reports ready', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-runtime-controller-'))
    temporaryDirectories.push(directory)
    const entryPath = path.join(directory, 'runtime-fixture.mjs')
    await writeFile(
      entryPath,
      `
        let activeRunId;
        process.on('message', (message) => {
          if (message.type === 'execute') activeRunId = message.manifest.runId;
          if (message.type === 'cancel' && message.runId === activeRunId) {
            process.send({ type: 'run-cancelled', message: 'cancelled' });
          }
        });
        setTimeout(() => process.send({
          type: 'runtime-ready', cordisVersion: '4.0.0-rc.8'
        }), 50);
      `,
      'utf8',
    )
    const controller = new RuntimeController(entryPath, new AppLogger(path.join(directory, 'logs')))
    const { manifest } = createRunFixture()

    const execution = controller.execute(manifest, () => undefined)
    expect(controller.cancel(manifest.runId)).toBe(true)
    await expect(execution).resolves.toEqual({ status: 'cancelled' })
    await controller.stopAll()
  })

  it('marks a child that ignores cooperative cancellation as timed out after cleanup', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-runtime-timeout-'))
    temporaryDirectories.push(directory)
    const entryPath = path.join(directory, 'runtime-fixture.mjs')
    await writeFile(
      entryPath,
      `
        process.on('message', () => undefined);
        process.send({ type: 'runtime-ready', cordisVersion: '4.0.0-rc.8' });
      `,
      'utf8',
    )
    const controller = new RuntimeController(entryPath, new AppLogger(path.join(directory, 'logs')))
    const { manifest } = createRunFixture()
    manifest.reproducibility.timeoutMs = 500

    await expect(controller.execute(manifest, () => undefined)).resolves.toEqual({
      status: 'timed-out',
    })
    await controller.stopAll()
  })

  it('turns an event-consumer exception into a controlled Runtime failure and cleans the child', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-runtime-event-error-'))
    temporaryDirectories.push(directory)
    const entryPath = path.join(directory, 'runtime-fixture.mjs')
    await writeFile(
      entryPath,
      `
        process.on('message', (message) => {
          if (message.type === 'execute') process.send({
            type: 'run-event',
            event: { type: 'runtime-ready', message: 'event', details: {} }
          });
        });
        process.send({ type: 'runtime-ready', cordisVersion: '4.0.0-rc.8' });
      `,
      'utf8',
    )
    const controller = new RuntimeController(entryPath, new AppLogger(path.join(directory, 'logs')))
    const { manifest } = createRunFixture()

    await expect(
      controller.execute(manifest, () => {
        throw new Error('event consumer failed')
      }),
    ).rejects.toThrow('event consumer failed')
    await controller.stopAll()
  })
})
