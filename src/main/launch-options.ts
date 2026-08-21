import path from 'node:path'

export interface LaunchOptions {
  projectPath: string | null
}

export function parseLaunchOptions(argv: readonly string[], cwd = process.cwd()): LaunchOptions {
  const projectIndexes = argv.flatMap((argument, index) =>
    argument === '--project' ? [index] : [],
  )
  if (projectIndexes.length > 1) throw new Error('启动参数 --project 只能指定一次。')
  if (projectIndexes.length === 0) return { projectPath: null }

  const value = argv[projectIndexes[0] + 1]
  if (!value || value.startsWith('--')) throw new Error('启动参数 --project 需要项目路径。')
  return { projectPath: path.resolve(cwd, value) }
}
