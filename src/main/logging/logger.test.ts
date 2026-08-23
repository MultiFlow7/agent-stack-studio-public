import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppLogger } from './logger'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('AppLogger', () => {
  it('serializes concurrent writes, redacts secrets and keeps the log private', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studio-logger-'))
    directories.push(directory)
    const logDirectory = path.join(directory, 'logs')
    const logger = new AppLogger(logDirectory)

    await Promise.all([
      logger.write('info', 'first', { authorization: 'Bearer raw-secret' }),
      logger.write('error', 'second', {
        message: 'https://user:pass@example.test/path?token=query-secret',
      }),
    ])

    const logPath = path.join(logDirectory, 'studio.log')
    const contents = await readFile(logPath, 'utf8')
    expect(contents.trim().split('\n')).toHaveLength(2)
    expect(contents).not.toContain('raw-secret')
    expect(contents).not.toContain('user:pass')
    expect(contents).not.toContain('query-secret')
    expect((await stat(logDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(logPath)).mode & 0o777).toBe(0o600)
  })
})
