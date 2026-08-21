import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const httpsUrl = z
  .url()
  .refine((value) => new URL(value).protocol === 'https:', '发布地址必须使用 HTTPS。')

export const releaseConfigSchema = z
  .object({
    $schema: z.literal('../schemas/release-config-v1.schema.json'),
    contractVersion: z.literal(1),
    channel: z.enum(['local', 'alpha', 'beta', 'stable']),
    downloadBaseUrl: httpsUrl.nullable(),
    updateFeedUrl: httpsUrl.nullable(),
    automaticUpdates: z.literal(false),
    requirements: z
      .object({
        developerIdSignature: z.boolean(),
        notarization: z.boolean(),
        staple: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.requirements.notarization && !config.requirements.developerIdSignature) {
      context.addIssue({
        code: 'custom',
        path: ['requirements', 'notarization'],
        message: '要求公证时必须同时要求 Developer ID 签名。',
      })
    }
    if (config.requirements.staple && !config.requirements.notarization) {
      context.addIssue({
        code: 'custom',
        path: ['requirements', 'staple'],
        message: '要求 staple 时必须同时要求 Apple 公证。',
      })
    }
  })

function booleanOverride(environment, name, fallback) {
  const value = environment[name]
  if (value === undefined) return fallback
  if (value === '1') return true
  if (value === '0') return false
  throw new Error(`${name} 只能是 0 或 1。`)
}

function nullableStringOverride(environment, name, fallback) {
  const value = environment[name]
  if (value === undefined) return fallback
  return value === '' ? null : value
}

export async function loadReleaseConfiguration(options = {}) {
  const projectPath = path.resolve(options.projectPath ?? '.')
  const environment = options.environment ?? process.env
  const configPath = path.resolve(
    projectPath,
    options.configPath ?? environment.STUDIO_RELEASE_CONFIG ?? 'config/release.default.json',
  )
  const fileConfig = JSON.parse(await readFile(configPath, 'utf8'))
  const resolved = {
    ...fileConfig,
    channel: environment.STUDIO_RELEASE_CHANNEL ?? fileConfig.channel,
    downloadBaseUrl: nullableStringOverride(
      environment,
      'STUDIO_RELEASE_DOWNLOAD_BASE_URL',
      fileConfig.downloadBaseUrl,
    ),
    updateFeedUrl: nullableStringOverride(
      environment,
      'STUDIO_RELEASE_UPDATE_FEED_URL',
      fileConfig.updateFeedUrl,
    ),
    requirements: {
      developerIdSignature: booleanOverride(
        environment,
        'STUDIO_RELEASE_REQUIRE_SIGNED',
        fileConfig.requirements?.developerIdSignature,
      ),
      notarization: booleanOverride(
        environment,
        'STUDIO_RELEASE_REQUIRE_NOTARIZED',
        fileConfig.requirements?.notarization,
      ),
      staple: booleanOverride(
        environment,
        'STUDIO_RELEASE_REQUIRE_STAPLED',
        fileConfig.requirements?.staple,
      ),
    },
  }
  const parsed = releaseConfigSchema.safeParse(resolved)
  if (!parsed.success) {
    throw new Error(`发布配置无效：${z.prettifyError(parsed.error)}`)
  }
  return { configPath, config: parsed.data }
}
