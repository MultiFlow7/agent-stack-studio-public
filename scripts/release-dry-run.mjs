import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadReleaseConfiguration } from './release-config.mjs'
import { verifyMacosPackage } from './verify-macos-package.mjs'

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} 失败（${signal ?? `exit ${code}`}）。`))
    })
  })
}

export function notarizationCredentialMode(environment = process.env) {
  if (environment.APPLE_API_KEY && environment.APPLE_API_KEY_ID && environment.APPLE_API_ISSUER) {
    return 'app-store-connect-api'
  }
  if (
    environment.APPLE_ID &&
    environment.APPLE_APP_SPECIFIC_PASSWORD &&
    environment.APPLE_TEAM_ID
  ) {
    return 'apple-id'
  }
  if (environment.APPLE_KEYCHAIN_PROFILE) return 'keychain-profile'
  return 'none'
}

function appleStep({ id, label, required, verified, missingReason }) {
  if (verified) return { id, label, status: 'verified', reason: '最终应用包已验证。' }
  return {
    id,
    label,
    status: required ? 'blocked' : 'skipped',
    reason: required
      ? `当前发布配置要求此项，但${missingReason}`
      : `${missingReason}无凭证 dry-run 明确跳过。`,
  }
}

export function buildReleaseDryRunReport(input) {
  const { config, packageResult, compatibility, applicationVersion, architecture } = input
  const policySteps = [
    appleStep({
      id: 'developer-id-signature',
      label: 'Developer ID 签名',
      required: config.requirements.developerIdSignature,
      verified: packageResult.signed,
      missingReason: '最终应用包没有 Developer ID Application 签名。',
    }),
    appleStep({
      id: 'apple-notarization',
      label: 'Apple 公证',
      required: config.requirements.notarization,
      verified: packageResult.notarized,
      missingReason: '最终应用包没有可验证的 Apple 公证票据。',
    }),
    appleStep({
      id: 'staple-ticket',
      label: '公证票据 staple',
      required: config.requirements.staple,
      verified: packageResult.notarized,
      missingReason: '`xcrun stapler validate` 未验证到票据。',
    }),
  ]

  policySteps.push(
    config.channel === 'local'
      ? {
          id: 'release-channel',
          label: '发布渠道',
          status: 'disabled',
          reason: 'local 渠道只生成本地产物，不上传。',
        }
      : config.downloadBaseUrl
        ? {
            id: 'release-channel',
            label: '发布渠道',
            status: 'ready',
            reason: `${config.channel} 渠道与 HTTPS 下载基址已注入，dry-run 不上传。`,
          }
        : {
            id: 'release-channel',
            label: '发布渠道',
            status: 'blocked',
            reason: `${config.channel} 渠道缺少 downloadBaseUrl。`,
          },
  )
  policySteps.push({
    id: 'automatic-updates',
    label: '自动更新',
    status: 'disabled',
    reason: config.updateFeedUrl
      ? '更新地址已注入作为未来分发元数据；当前契约仍禁用自动更新。'
      : '当前本地版本不启用自动更新，也未注入更新地址。',
  })

  const steps = [...(input.verificationSteps ?? []), ...policySteps]
  return {
    contractVersion: 1,
    mode: 'dry-run',
    outcome: steps.some(({ status }) => status === 'blocked' || status === 'failed')
      ? 'blocked'
      : 'complete',
    applicationVersion,
    architecture,
    config,
    compatibility,
    credentialPresence: { notarization: input.notarizationCredentials },
    steps,
    artifacts: {
      applicationPath: packageResult.applicationPath,
      checksumPath: packageResult.checksumPath,
      cliPath: packageResult.cliPath,
    },
  }
}

function parseOptions(argv) {
  const options = { reusePackage: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--reuse-package') options.reusePackage = true
    else if (argument === '--config') options.configPath = argv[++index]
    else if (argument === '--report') options.reportPath = argv[++index]
    else throw new Error(`未知 release dry-run 参数：${argument}`)
  }
  if (options.configPath === undefined && argv.includes('--config')) {
    throw new Error('--config 需要文件路径。')
  }
  if (options.reportPath === undefined && argv.includes('--report')) {
    throw new Error('--report 需要文件路径。')
  }
  return options
}

export async function runReleaseDryRun(options = {}) {
  if (process.platform !== 'darwin') throw new Error('release dry-run 当前只支持 macOS。')
  const projectPath = path.resolve(options.projectPath ?? '.')
  const environment = options.environment ?? process.env
  const { configPath, config } = await loadReleaseConfiguration({
    projectPath,
    configPath: options.configPath,
    environment,
  })
  const compatibility = JSON.parse(
    await readFile(path.join(projectPath, 'config/release-compatibility.json'), 'utf8'),
  )
  const packageJson = JSON.parse(await readFile(path.join(projectPath, 'package.json'), 'utf8'))
  const verificationSteps = []
  if (!options.reusePackage) {
    for (const [id, label, script] of [
      ['quality-checks', '格式、Lint、类型、测试与构建', 'check'],
      ['cli-package', 'CLI 打包', 'package:cli'],
      ['macos-package', 'macOS 打包', 'package:mac'],
      ['package-verification', '最终包验证', 'verify:mac-package'],
      ['packaged-e2e', '打包 GUI/CLI E2E', 'test:e2e:packaged'],
    ]) {
      await run('npm', ['run', script], projectPath)
      verificationSteps.push({ id, label, status: 'verified', reason: `npm run ${script} 通过。` })
    }
  } else {
    verificationSteps.push({
      id: 'package-reuse',
      label: '复用当前包',
      status: 'verified',
      reason: '调用方显式使用 --reuse-package；仍重新执行最终包验证。',
    })
  }
  const packageResult = await verifyMacosPackage({ requireSigned: false, requireNotarized: false })
  const report = {
    generatedAt: new Date().toISOString(),
    configPath,
    ...buildReleaseDryRunReport({
      config,
      compatibility,
      packageResult,
      applicationVersion: packageJson.version,
      architecture: process.arch,
      notarizationCredentials: notarizationCredentialMode(environment),
      verificationSteps,
    }),
  }
  const reportPath = path.resolve(
    projectPath,
    options.reportPath ??
      path.join(
        packageJson.build.directories.output,
        `release-dry-run-${packageJson.version}-${process.arch}.json`,
      ),
  )
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  if (report.outcome === 'blocked') {
    throw new Error(`release dry-run 已写入阻断报告：${reportPath}`)
  }
  return { reportPath, report }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseOptions(process.argv.slice(2))
  runReleaseDryRun(options)
    .then(({ reportPath, report }) => {
      console.log(`RELEASE_DRY_RUN ${report.outcome.toUpperCase()}`)
      console.log(`REPORT ${reportPath}`)
      for (const step of report.steps) {
        console.log(`${step.status.toUpperCase()} ${step.id} ${step.reason}`)
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
