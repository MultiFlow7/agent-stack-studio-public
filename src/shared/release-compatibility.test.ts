import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import packageMetadata from '../../package.json'
import { PROJECT_FORMAT_VERSION, PROJECT_SCHEMA_ID } from '../core/project-model'
import { CURRENT_SCHEMA_VERSION } from '../main/persistence/migrations'
import { releaseCompatibility } from './release-compatibility'
import {
  AGENT_STACK_PACKAGE_FORMAT_VERSION,
  AGENT_STACK_PACKAGE_SCHEMA_ID,
} from './agent-stack-package'

describe('release compatibility manifest', () => {
  it('binds application, project, database, package, and schema metadata without another version copy', async () => {
    const projectSchema = z
      .object({
        $id: z.string(),
        properties: z.object({ formatVersion: z.object({ const: z.number() }) }),
      })
      .parse(
        JSON.parse(await readFile(path.resolve(releaseCompatibility.project.schemaPath), 'utf8')),
      )
    const packageSchema = z
      .object({
        $id: z.string(),
        properties: z.object({ packageFormatVersion: z.object({ const: z.number() }) }),
      })
      .parse(
        JSON.parse(
          await readFile(path.resolve(releaseCompatibility.agentStackPackage.schemaPath), 'utf8'),
        ),
      )
    expect(releaseCompatibility.application.versionSource).toBe('package.json#version')
    expect(packageMetadata.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(releaseCompatibility.project.currentFormatVersion).toBe(PROJECT_FORMAT_VERSION)
    expect(releaseCompatibility.project.schemaId).toBe(PROJECT_SCHEMA_ID)
    expect(projectSchema.$id).toBe(PROJECT_SCHEMA_ID)
    expect(projectSchema.properties.formatVersion.const).toBe(PROJECT_FORMAT_VERSION)
    expect(releaseCompatibility.agentStackPackage.currentFormatVersion).toBe(
      AGENT_STACK_PACKAGE_FORMAT_VERSION,
    )
    expect(releaseCompatibility.agentStackPackage.schemaId).toBe(AGENT_STACK_PACKAGE_SCHEMA_ID)
    expect(packageSchema.$id).toBe(AGENT_STACK_PACKAGE_SCHEMA_ID)
    expect(packageSchema.properties.packageFormatVersion.const).toBe(
      AGENT_STACK_PACKAGE_FORMAT_VERSION,
    )
    expect(releaseCompatibility.database.currentSchemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(packageMetadata.build.appId).toBe(releaseCompatibility.application.bundleId)
    expect(packageMetadata.build.mac.minimumSystemVersion).toBe(
      releaseCompatibility.application.minimumMacOS,
    )
  })

  it('keeps future distribution changes outside product protocols', () => {
    expect(releaseCompatibility.distributionOnlyMutableFields).toEqual([
      'credentials',
      'appleNotarization',
      'releaseMetadata',
      'downloadBaseUrl',
      'updateFeedUrl',
      'channel',
      'applePlatformRequirements',
    ])
    expect(releaseCompatibility.contracts).toEqual({
      domainModel: 1,
      ipc: 1,
      runtimeProtocol: 1,
      cliEnvelope: 1,
    })
  })
})
