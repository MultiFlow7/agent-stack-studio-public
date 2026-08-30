import {
  studioDoctorFactsSchema,
  studioDoctorReportSchema,
  type StudioDoctorFacts,
  type StudioDoctorReport,
} from '../shared/doctor'

type Check = StudioDoctorReport['checks'][number]

function check(input: Check): Check {
  return input
}

export function buildStudioDoctorReport(
  input: StudioDoctorFacts,
  now: () => Date = () => new Date(),
): StudioDoctorReport {
  const facts = studioDoctorFactsSchema.parse(input)
  const checks: Check[] = []

  checks.push(
    check({
      id: 'application-platform',
      category: 'application',
      status: facts.application.platform === 'darwin' ? 'pass' : 'blocking',
      title: 'macOS 运行边界',
      summary:
        facts.application.platform === 'darwin'
          ? `Agent Stack Studio ${facts.application.version} 运行于 ${facts.application.architecture} macOS。`
          : `当前平台 ${facts.application.platform} 不在产品支持范围内。`,
      remediation:
        facts.application.platform === 'darwin' ? null : '请在 macOS 12 或更高版本上运行。',
      facts: {
        version: facts.application.version,
        architecture: facts.application.architecture,
        packaged: facts.application.packaged,
      },
    }),
  )

  const distributedCli = facts.application.cliExecutable && facts.application.bundledCliRuntime
  checks.push(
    check({
      id: 'cli-distribution',
      category: 'application',
      status: distributedCli ? 'pass' : facts.application.packaged ? 'blocking' : 'warning',
      title: '包内 CLI',
      summary: distributedCli
        ? 'studio CLI 可执行，并使用 App 内置运行时。'
        : facts.application.packaged
          ? '打包 App 中的 studio CLI 不可执行或未使用内置运行时。'
          : '开发构建使用系统 Node.js；最终分发验收需在打包 App 中运行。',
      remediation: distributedCli
        ? null
        : facts.application.packaged
          ? '重新安装完整 App，并运行包验证。'
          : '使用 npm run package:mac 生成并验证 App。',
      facts: {
        cliExecutable: facts.application.cliExecutable,
        bundledCliRuntime: facts.application.bundledCliRuntime,
      },
    }),
  )

  if (facts.data) {
    const schemaCurrent =
      facts.data.databaseSchemaVersion === facts.data.supportedDatabaseSchemaVersion
    checks.push(
      check({
        id: 'database-migration',
        category: 'data',
        status: schemaCurrent ? 'pass' : 'warning',
        title: 'SQLite 迁移',
        summary: schemaCurrent
          ? `SQLite schema v${facts.data.databaseSchemaVersion} 已是当前版本。`
          : `SQLite schema v${facts.data.databaseSchemaVersion} 需迁移到 v${facts.data.supportedDatabaseSchemaVersion}。`,
        remediation: schemaCurrent ? null : '退出并重新打开 App 以完成事务式迁移。',
        facts: {
          current: facts.data.databaseSchemaVersion,
          supported: facts.data.supportedDatabaseSchemaVersion,
        },
      }),
    )
    checks.push(
      check({
        id: 'backup-recovery',
        category: 'data',
        status: facts.data.pendingRestore ? 'warning' : 'pass',
        title: '备份与恢复',
        summary: facts.data.pendingRestore
          ? '已存在待应用的恢复，需重启 App。'
          : facts.data.lastRestoreAt
            ? `无待恢复任务；最近恢复于 ${facts.data.lastRestoreAt}。`
            : '无待恢复任务；尚未执行恢复。',
        remediation: facts.data.pendingRestore ? '重启 App 以应用已验证的恢复。' : null,
        facts: {
          pendingRestore: facts.data.pendingRestore,
          lastRestoreAt: facts.data.lastRestoreAt,
        },
      }),
    )
  }

  checks.push(
    check({
      id: 'project-integrity',
      category: 'project',
      status:
        facts.project.status === 'healthy'
          ? 'pass'
          : facts.project.status === 'missing'
            ? 'warning'
            : 'blocking',
      title: '.agent-stack 完整性',
      summary: facts.project.message,
      remediation:
        facts.project.status === 'healthy'
          ? null
          : facts.project.status === 'missing'
            ? '打开现有项目，或使用 studio agent create 创建项目。'
            : '先保留现场，再根据完整性错误恢复 .agent-stack.backup。',
      facts: {
        name: facts.project.name,
        revision: facts.project.revision,
        formatVersion: facts.project.formatVersion,
        versionsChecked: facts.project.versionsChecked,
      },
    }),
  )

  for (const harness of facts.harnesses) {
    checks.push(
      check({
        id: `harness-${harness.id}`,
        category: 'harness',
        status: harness.status === 'ready' ? 'pass' : 'warning',
        title: `${harness.label} Harness`,
        summary: `${harness.detail}此项只验证 Host Driver 与 CLI 版本，不调用模型；凭证仍需通过真实 run/chat 验收。`,
        remediation:
          harness.status === 'ready'
            ? null
            : harness.status === 'authentication-required'
              ? `为 ${harness.label} 配置本机认证。`
              : `安装 ${harness.label} ${harness.requiredVersion} 并重新运行 doctor。`,
        facts: {
          status: harness.status,
          version: harness.version,
          requiredVersion: harness.requiredVersion,
        },
      }),
    )
  }

  checks.push(
    check({
      id: 'multica-publish',
      category: 'publish',
      status: facts.multica.status === 'ready' ? 'pass' : 'warning',
      title: 'Multica 发布',
      summary: facts.multica.message,
      remediation:
        facts.multica.status === 'ready'
          ? null
          : facts.multica.status === 'not-installed'
            ? '安装官方 Multica CLI v0.4.32 或更高版本。'
            : facts.multica.status === 'authentication-required'
              ? '运行 multica login，然后确认至少一个 Runtime 在线。'
              : '检查 Multica CLI 版本、认证和网络状态。',
      facts: {
        status: facts.multica.status,
        runtimeCount: facts.multica.runtimeCount,
        onlineRuntimeCount: facts.multica.onlineRuntimeCount,
      },
    }),
  )

  const counts = {
    passed: checks.filter(({ status }) => status === 'pass').length,
    warnings: checks.filter(({ status }) => status === 'warning').length,
    blocking: checks.filter(({ status }) => status === 'blocking').length,
  }
  return studioDoctorReportSchema.parse({
    schemaVersion: 1,
    checkedAt: now().toISOString(),
    status: counts.blocking > 0 ? 'blocked' : counts.warnings > 0 ? 'degraded' : 'ready',
    counts,
    checks,
  })
}
