import path from 'node:path'
import {
  sourceHandoffSchema,
  type DiscoveredRepository,
  type SourceHandoff,
  type SourceLocatorInput,
  type SourceSearchInput,
  type SourceSearchResult,
} from '../shared/source-discovery'

export interface SourceDiscoveryProvider {
  readonly id: SourceSearchInput['provider']
  search(input: SourceSearchInput, signal?: AbortSignal): Promise<SourceSearchResult>
  inspect(input: SourceLocatorInput, signal?: AbortSignal): Promise<DiscoveredRepository>
}

export function createSourceHandoff(
  repository: DiscoveredRepository,
  destination?: string,
  now: () => Date = () => new Date(),
): SourceHandoff {
  const target = destination?.trim() || repository.name
  return sourceHandoffSchema.parse({
    formatVersion: 1,
    provider: repository.provider,
    repository,
    destination: target,
    commands: [
      {
        purpose: 'clone',
        executable: 'git',
        args: ['clone', '--filter=blob:none', '--', repository.cloneUrl, target],
        requiresReview: true,
      },
      {
        purpose: 'inspect',
        executable: 'studio',
        args: ['component', 'inspect', path.resolve(target), '--json', '--non-interactive'],
        requiresReview: true,
      },
    ],
    safetyNotice:
      'Studio 只生成交接计划，不会执行这些命令。下载后应先静态检查，再决定是否导入或运行第三方代码。',
    createdAt: now().toISOString(),
  })
}
