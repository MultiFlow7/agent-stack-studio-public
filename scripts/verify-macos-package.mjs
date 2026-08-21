import { execFile } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { extractFile } from '@electron/asar'
import { checksumManifestName, verifyReleaseChecksums } from './release-integrity.mjs'
import { verifyPackagedSecurity } from './verify-security-boundaries.mjs'

const execute = promisify(execFile)
const expectedBundleId = 'studio.agentstack.desktop'
const expectedMinimumSystemVersion = '12.0'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function findPackagedApplication(releasePath) {
  const candidates = []
  for (const entry of await readdir(releasePath, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('mac')) continue
    candidates.push(path.join(releasePath, entry.name, 'Agent Stack Studio.app'))
  }
  for (const candidate of candidates.sort()) {
    if (await exists(candidate)) return candidate
  }
  throw new Error('未在 release/mac* 中找到 Agent Stack Studio.app。')
}

async function plistValue(plistPath, key) {
  const { stdout } = await execute('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath])
  return stdout.trim()
}

async function commandSucceeded(command, args) {
  try {
    const result = await execute(command, args)
    return { succeeded: true, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return {
      succeeded: false,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
    }
  }
}

export function validatePackageMetadata({ bundleId, minimumSystemVersion }) {
  if (bundleId !== expectedBundleId) throw new Error(`意外的 Bundle ID：${bundleId}`)
  if (minimumSystemVersion !== expectedMinimumSystemVersion) {
    throw new Error(`意外的最低 macOS 版本：${minimumSystemVersion}`)
  }
}

export function hasDeveloperIdSignature(signatureDetails) {
  return /(?:^|\n)Authority=Developer ID Application:/.test(signatureDetails)
}

export async function verifyMacosPackage(options = {}) {
  if (process.platform !== 'darwin') throw new Error('只能在 macOS 上验证 macOS 应用包。')
  const applicationPath =
    options.applicationPath ??
    (await findPackagedApplication(path.resolve(options.releasePath ?? 'release')))
  const plistPath = path.join(applicationPath, 'Contents', 'Info.plist')
  const bundleId = await plistValue(plistPath, 'CFBundleIdentifier')
  const minimumSystemVersion = await plistValue(plistPath, 'LSMinimumSystemVersion')
  const version = await plistValue(plistPath, 'CFBundleShortVersionString')
  const iconFile = await plistValue(plistPath, 'CFBundleIconFile')
  validatePackageMetadata({ bundleId, minimumSystemVersion })
  await access(path.join(applicationPath, 'Contents', 'MacOS', 'Agent Stack Studio'))
  await access(path.join(applicationPath, 'Contents', 'Resources', 'app.asar'))
  if (!iconFile.toLowerCase().endsWith('.icns')) throw new Error(`意外的应用图标：${iconFile}`)
  await access(path.join(applicationPath, 'Contents', 'Resources', iconFile))
  const archivePath = path.join(applicationPath, 'Contents', 'Resources', 'app.asar')
  const projectPath = path.resolve(options.projectPath ?? '.')
  for (const relativePath of [
    'config/release-compatibility.json',
    'config/release.default.json',
    'schemas/project-v1.schema.json',
    'schemas/agent-stack-package-v1.schema.json',
    'schemas/project-v2.schema.json',
    'schemas/agent-stack-package-v2.schema.json',
    'schemas/release-config-v1.schema.json',
  ]) {
    const packaged = extractFile(archivePath, relativePath)
    const source = await readFile(path.join(projectPath, relativePath))
    if (!packaged.equals(source)) throw new Error(`打包分发契约与源文件不一致：${relativePath}`)
  }
  const cliPath = path.join(
    applicationPath,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'dist',
    'cli',
    'studio.mjs',
  )
  await access(cliPath)
  verifyPackagedSecurity(applicationPath)

  const architecture = path.basename(path.dirname(applicationPath)) === 'mac' ? 'x64' : 'arm64'
  const releasePath = path.dirname(path.dirname(applicationPath))
  const artifactStem = `Agent Stack Studio-${version}-${architecture}`
  const checksumPath = path.join(releasePath, checksumManifestName({ version, architecture }))
  await verifyReleaseChecksums({
    checksumPath,
    releaseCompatibilityVerified: true,
    artifactPaths: [
      path.join(releasePath, `${artifactStem}.dmg`),
      path.join(releasePath, `${artifactStem}.zip`),
    ],
  })

  const signature = await commandSucceeded('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    applicationPath,
  ])
  const signatureDetails = signature.succeeded
    ? await commandSucceeded('/usr/bin/codesign', ['--display', '--verbose=4', applicationPath])
    : { succeeded: false, stdout: '', stderr: '' }
  const developerIdSigned =
    signature.succeeded &&
    signatureDetails.succeeded &&
    hasDeveloperIdSignature(`${signatureDetails.stdout}\n${signatureDetails.stderr}`)
  const notarization = developerIdSigned
    ? await commandSucceeded('/usr/bin/xcrun', ['stapler', 'validate', applicationPath])
    : { succeeded: false, stdout: '', stderr: '' }

  const requireSigned = options.requireSigned ?? process.env.STUDIO_REQUIRE_SIGNED === '1'
  const requireNotarized = options.requireNotarized ?? process.env.STUDIO_REQUIRE_NOTARIZED === '1'
  if (requireSigned && !developerIdSigned) {
    throw new Error('当前应用包没有可验证的 Developer ID 签名。')
  }
  if (requireNotarized && !notarization.succeeded) {
    throw new Error('当前应用包没有可验证的公证票据。')
  }

  return {
    applicationPath,
    bundleId,
    minimumSystemVersion,
    iconFile,
    signed: developerIdSigned,
    notarized: notarization.succeeded,
    cliPath,
    checksumPath,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyMacosPackage({ applicationPath: process.argv[2] })
    .then((result) => {
      console.log(`PACKAGE_OK ${result.applicationPath}`)
      console.log(`BUNDLE_ID ${result.bundleId}`)
      console.log(`MINIMUM_MACOS ${result.minimumSystemVersion}`)
      console.log(`ICON ${result.iconFile}`)
      console.log(`CLI ${result.cliPath}`)
      console.log('SECURITY_BOUNDARIES VERIFIED')
      console.log(`SHA256 ${result.checksumPath}`)
      console.log('RELEASE_COMPATIBILITY VERIFIED')
      console.log(result.signed ? 'SIGNATURE VERIFIED' : 'SIGNATURE NOT_PRESENT')
      console.log(result.notarized ? 'NOTARIZATION VERIFIED' : 'NOTARIZATION NOT_PRESENT')
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
