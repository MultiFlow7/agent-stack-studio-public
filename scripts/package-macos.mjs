import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checksumManifestName, formatChecksumManifest, sha256File } from './release-integrity.mjs'

export function macosArtifactNames({ productName, version, architecture }) {
  const stem = `${productName}-${version}-${architecture}`
  return { dmg: `${stem}.dmg`, zip: `${stem}.zip` }
}

export function macosApplicationDirectory(architecture) {
  return architecture === 'x64' ? 'mac' : `mac-${architecture}`
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} 失败（${signal ?? `exit ${code ?? 'unknown'}`}）。`))
    })
  })
}

export async function packageMacos(options = {}) {
  if (process.platform !== 'darwin') throw new Error('只能在 macOS 上生成 macOS 安装包。')
  const projectPath = path.resolve(options.projectPath ?? '.')
  const packageJson = JSON.parse(await readFile(path.join(projectPath, 'package.json'), 'utf8'))
  const productName = packageJson.build.productName
  const architecture = process.arch
  const artifacts = macosArtifactNames({
    productName,
    version: packageJson.version,
    architecture,
  })
  const releasePath = path.join(projectPath, packageJson.build.directories.output)
  const applicationPath = path.join(
    releasePath,
    macosApplicationDirectory(architecture),
    `${productName}.app`,
  )
  const zipPath = path.join(releasePath, artifacts.zip)
  const dmgPath = path.join(releasePath, artifacts.dmg)

  await run(
    path.join(projectPath, 'node_modules', '.bin', 'electron-builder'),
    ['--mac', '--dir', '--config.electronDist=node_modules/electron/dist'],
    projectPath,
  )

  await rm(zipPath, { force: true })
  await run(
    '/usr/bin/ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', applicationPath, zipPath],
    projectPath,
  )

  const stagingPath = await mkdtemp(path.join(tmpdir(), 'agent-stack-studio-dmg-'))
  try {
    await mkdir(stagingPath, { recursive: true })
    await run(
      '/usr/bin/ditto',
      [applicationPath, path.join(stagingPath, `${productName}.app`)],
      projectPath,
    )
    await symlink('/Applications', path.join(stagingPath, 'Applications'))
    await rm(dmgPath, { force: true })
    await run(
      '/usr/bin/hdiutil',
      [
        'create',
        '-volname',
        `${productName} ${packageJson.version}`,
        '-srcfolder',
        stagingPath,
        '-ov',
        '-format',
        'UDZO',
        dmgPath,
      ],
      projectPath,
    )
  } finally {
    await rm(stagingPath, { recursive: true, force: true })
  }

  const checksumPath = path.join(
    releasePath,
    checksumManifestName({ version: packageJson.version, architecture }),
  )
  await writeFile(
    checksumPath,
    formatChecksumManifest([
      { fileName: path.basename(dmgPath), sha256: await sha256File(dmgPath) },
      { fileName: path.basename(zipPath), sha256: await sha256File(zipPath) },
    ]),
  )

  return { applicationPath, zipPath, dmgPath, checksumPath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageMacos()
    .then(({ applicationPath, zipPath, dmgPath, checksumPath }) => {
      console.log(`APP ${applicationPath}`)
      console.log(`ZIP ${zipPath}`)
      console.log(`DMG ${dmgPath}`)
      console.log(`SHA256 ${checksumPath}`)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
