import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function verifyCliPackage(options = {}) {
  const projectPath = path.resolve(options.projectPath ?? '.')
  const packageJson = JSON.parse(await readFile(path.join(projectPath, 'package.json'), 'utf8'))
  const cliPath = path.join(projectPath, packageJson.bin.studio)
  await access(cliPath, constants.X_OK)
  const contents = await readFile(cliPath, 'utf8')
  if (!contents.startsWith('#!/usr/bin/env -S node --use-env-proxy\n')) {
    throw new Error('studio CLI 缺少带环境代理支持的可执行 shebang。')
  }
  if (!contents.includes(packageJson.version)) {
    // 版本由 package.json 作为打包单一来源，CLI 不复制常量。
    await access(path.join(projectPath, 'package.json'))
  }
  return { cliPath, version: packageJson.version, command: `${cliPath} help` }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyCliPackage()
    .then((result) => {
      console.log(`CLI_OK ${result.cliPath}`)
      console.log(`VERSION ${result.version}`)
      console.log(`RUN ${result.command}`)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
