import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ImportService } from './import-service'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('ImportService', () => {
  it('expires in-memory scan sessions so local source paths are not retained indefinitely', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studio-import-session-'))
    directories.push(directory)
    await writeFile(path.join(directory, 'package.json'), '{"name":"fixture"}')
    let now = 1_000
    const service = new ImportService({ now: () => now, ttlMs: 100 })
    const scan = await service.scan(directory)

    now += 101
    expect(() => service.consume(scan.scanId)).toThrow('已失效')
  })
})
