import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createCodexSimulationServer } from './codex-openai-simulation.mjs'
import { macosApplicationDirectory } from './package-macos.mjs'

const execute = promisify(execFile)
const repositoryRoot = process.cwd()

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() =>
        port === null ? reject(new Error('PACKAGED_EXTERNAL_PORT_FAILED')) : resolve(port),
      )
    })
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForTarget(port, processState) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (processState.exitCode !== null) throw new Error('PACKAGED_APP_EXITED_EARLY')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        if (page) return page
      }
    } catch {
      // Chromium is still starting.
    }
    await delay(100)
  }
  throw new Error('PACKAGED_APP_TARGET_TIMEOUT')
}

function createCdpClient(url) {
  const socket = new WebSocket(url)
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(String(event.data))
    if (!payload.id) return
    const entry = pending.get(payload.id)
    if (!entry) return
    pending.delete(payload.id)
    if (payload.error) entry.reject(new Error(payload.error.message))
    else entry.resolve(payload.result)
  })
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('PACKAGED_APP_CDP_FAILED')), {
      once: true,
    })
  })
  return {
    async send(method, params = {}) {
      await opened
      const id = nextId++
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
      socket.send(JSON.stringify({ id, method, params }))
      return response
    },
    close() {
      socket.close()
    },
  }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) throw new Error('PACKAGED_APP_RENDERER_EVALUATION_FAILED')
  return response.result?.value
}

async function waitForExpression(client, expression, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return
    await delay(150)
  }
  throw new Error(
    `PACKAGED_APP_STATE_TIMEOUT:${createHash('sha256').update(expression).digest('hex')}`,
  )
}

async function clickButton(client, label) {
  const clicked = await evaluate(
    client,
    `(() => {
      const label = ${JSON.stringify(label)}
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === label && !element.disabled
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  if (!clicked) throw new Error(`PACKAGED_APP_BUTTON_NOT_FOUND:${label}`)
}

async function navigate(client, label, heading) {
  const clicked = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('nav button[aria-label=${JSON.stringify(label)}]')
      button?.focus()
      button?.click()
      return Boolean(button && !button.disabled)
    })()`,
  )
  if (!clicked) throw new Error(`PACKAGED_APP_NAVIGATION_NOT_FOUND:${label}`)
  await waitForExpression(
    client,
    `document.querySelector('h1')?.textContent === ${JSON.stringify(heading)}`,
    30_000,
  )
}

async function setLabeledValue(client, label, value) {
  const changed = await evaluate(
    client,
    `(() => {
      const labelText = ${JSON.stringify(label)}
      const value = ${JSON.stringify(value)}
      const field = [...document.querySelectorAll('label')].find(
        (element) => [...element.querySelectorAll(':scope > span')].some(
          (span) => span.textContent?.trim() === labelText
        )
      )?.querySelector('textarea, input, select')
      if (!field) return false
      const prototype = field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : field instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLSelectElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
  )
  if (!changed) throw new Error(`PACKAGED_APP_FIELD_NOT_FOUND:${label}`)
}

async function chooseHarness(client, label, expectedFeedback) {
  const readyExpression = `(() => {
    const label = ${JSON.stringify(label)}
    return [...document.querySelectorAll('button.native-harness-card')].some(
      (element) => element.querySelector('strong')?.textContent?.trim() === label && !element.disabled
    )
  })()`
  await waitForExpression(client, readyExpression, 30_000)
  const clicked = await evaluate(
    client,
    `(() => {
      const label = ${JSON.stringify(label)}
      const button = [...document.querySelectorAll('button.native-harness-card')].find(
        (element) => element.querySelector('strong')?.textContent?.trim() === label && !element.disabled
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  if (!clicked) throw new Error(`PACKAGED_APP_HARNESS_NOT_READY:${label}`)
  await waitForExpression(
    client,
    `document.body.innerText.includes(${JSON.stringify(expectedFeedback)})`,
  )
}

async function waitForNativeOutcome(client, marker, completedLabel, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const outcome = await evaluate(
      client,
      `(() => {
        const marker = ${JSON.stringify(marker)}
        const completedLabel = ${JSON.stringify(completedLabel)}
        const status = document.querySelector('.native-agent-panel [role=status]')?.textContent ?? ''
        const error = document.querySelector('.native-agent-panel [role=alert]')?.textContent?.trim() ?? ''
        if (document.body.innerText.includes(marker) && status.includes(completedLabel)) {
          return { state: 'succeeded', error: '' }
        }
        if (error) return { state: 'failed', error }
        return { state: 'pending', error: '' }
      })()`,
    )
    if (outcome?.state !== 'pending') return outcome
    await delay(150)
  }
  throw new Error(`PACKAGED_EXTERNAL_NATIVE_TIMEOUT:${marker}`)
}

async function submitNativeMessage(client, kind, marker) {
  const completedLabel = kind === 'chat' ? '已完成回复' : '已完成单次运行'
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await clickButton(client, kind === 'chat' ? '聊天' : '单次运行')
    await setLabeledValue(client, kind === 'chat' ? '消息' : '任务', `Reply exactly: ${marker}`)
    await clickButton(client, kind === 'chat' ? '发送' : '运行一次')
    await waitForExpression(
      client,
      `!document.querySelector('.native-agent-panel [role=alert]') || [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '正在执行…')`,
      5_000,
    )
    const outcome = await waitForNativeOutcome(client, marker, completedLabel)
    if (outcome.state === 'succeeded') return
    if (attempt === 2) throw new Error(`PACKAGED_EXTERNAL_NATIVE_FAILED:${kind}`)
    process.stdout.write(`PACKAGED_EXTERNAL_NATIVE_RETRY ${kind}\n`)
  }
}

async function capture(client, target) {
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  await writeFile(target, Buffer.from(screenshot.data, 'base64'))
}

async function waitForExit(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000).then(() => child.kill('SIGKILL')),
  ])
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('PACKAGED_EXTERNAL_REQUIRES_MACOS')
  if (process.env.STUDIO_PACKAGED_EXTERNAL_ACCEPTANCE !== '1') {
    throw new Error('Set STUDIO_PACKAGED_EXTERNAL_ACCEPTANCE=1 after authorizing remote publish.')
  }
  const applicationPath = path.join(
    repositoryRoot,
    'release',
    macosApplicationDirectory(process.arch),
    'Agent Stack Studio.app',
  )
  const executablePath = path.join(applicationPath, 'Contents', 'MacOS', 'Agent Stack Studio')
  const packagedCli = path.join(applicationPath, 'Contents', 'Resources', 'bin', 'studio')
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'studio-packaged-external-'))
  const projectRoot = path.join(temporaryRoot, 'project')
  const userDataPath = path.join(temporaryRoot, 'user-data')
  await mkdir(userDataPath, { recursive: true, mode: 0o700 })
  const simulation = await createCodexSimulationServer()
  let applicationProcess
  let client
  try {
    const simulationDetails = await simulation.listen()
    const environment = {
      ...process.env,
      PATH: '/usr/bin:/bin',
      STUDIO_USER_DATA_PATH: userDataPath,
      STUDIO_CAPTURE_USER_DATA_PATH: userDataPath,
      STUDIO_PACKAGED_E2E: '1',
      STUDIO_CODEX_SIMULATION: '1',
      STUDIO_CODEX_SIMULATION_URL: simulationDetails.endpoint,
    }
    const invoke = async (...args) => {
      const { stdout } = await execute(packagedCli, [...args, '--json'], {
        cwd: repositoryRoot,
        env: environment,
        timeout: 300_000,
        maxBuffer: 16 * 1024 * 1024,
      })
      const payload = JSON.parse(stdout)
      if (!payload.ok) throw new Error(`PACKAGED_CLI_FAILED:${payload.error?.code ?? 'UNKNOWN'}`)
      return payload
    }

    await invoke(
      'agent',
      'create',
      projectRoot,
      '--name',
      `Packaged External Acceptance ${Date.now().toString(36)}`,
    )
    const port = await availablePort()
    const state = { exitCode: null }
    applicationProcess = spawn(
      executablePath,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataPath}`,
        '--project',
        projectRoot,
      ],
      { env: environment, stdio: ['ignore', 'ignore', 'ignore'] },
    )
    applicationProcess.once('exit', (code) => {
      state.exitCode = code
    })
    const target = await waitForTarget(port, state)
    client = createCdpClient(target.webSocketDebuggerUrl)
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'", 30_000)

    await navigate(client, '运行', '运行记录')
    await chooseHarness(client, 'Pi', '已选择 Pi。')
    await setLabeledValue(client, 'Agent Prompt', 'Use only the supplied message and be concise.')
    await setLabeledValue(client, 'Markdown Memory', '# Acceptance Memory\nPackaged GUI boundary.')
    await setLabeledValue(
      client,
      '主要 Skill（Markdown）',
      '# Acceptance Skill\nReturn exact markers.',
    )
    await clickButton(client, '保存 Agent 配置')
    await waitForExpression(
      client,
      "document.body.innerText.includes('Prompt、Memory、Skill 与 MCP 配置已写入项目事实。')",
    )
    await submitNativeMessage(client, 'chat', 'PACKAGED_PI_CHAT_ONE_OK')
    const piSessionPrefix = await evaluate(
      client,
      "document.querySelector('.native-execute-actions small')?.textContent ?? ''",
    )
    await submitNativeMessage(client, 'chat', 'PACKAGED_PI_CHAT_TWO_OK')
    const piResumedPrefix = await evaluate(
      client,
      "document.querySelector('.native-execute-actions small')?.textContent ?? ''",
    )
    if (!piSessionPrefix || piSessionPrefix !== piResumedPrefix) {
      throw new Error('PACKAGED_PI_SESSION_NOT_RESUMED')
    }
    await submitNativeMessage(client, 'run', 'PACKAGED_PI_RUN_OK')
    process.stdout.write('PACKAGED_EXTERNAL_PI VERIFIED\n')
    const artifactsRoot = path.join(repositoryRoot, 'artifacts')
    await mkdir(artifactsRoot, { recursive: true })
    await capture(client, path.join(artifactsRoot, 'packaged-external-pi-native.png'))

    await navigate(client, 'Agent', 'Agent')
    const openedAgent = await evaluate(
      client,
      `(() => {
        const button = document.querySelector('.agent-row')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!openedAgent) throw new Error('PACKAGED_EXTERNAL_AGENT_NOT_FOUND')
    await waitForExpression(client, "Boolean(document.querySelector('.detail-header'))", 30_000)
    await clickButton(client, '冻结 Agent Version')
    await waitForExpression(
      client,
      "document.body.innerText.includes('已冻结不可变 Agent Version 1。')",
    )
    await clickButton(client, '发布版本')
    await waitForExpression(client, "document.body.innerText.includes('发布预检通过')")
    const guiPackageHashPrefix = await evaluate(
      client,
      "document.querySelector('.publish-package code')?.textContent?.trim() ?? ''",
    )
    const confirmed = await evaluate(
      client,
      `(() => {
        const checkbox = [...document.querySelectorAll('input[type=checkbox]')].find(
          (element) => element.closest('label')?.textContent?.includes('我已检查发布范围')
        )
        if (!checkbox || checkbox.disabled) return false
        checkbox.click()
        return true
      })()`,
    )
    if (!confirmed) throw new Error('PACKAGED_EXTERNAL_PUBLISH_NOT_READY')
    await clickButton(client, '发布此版本到 Multica')
    await waitForExpression(
      client,
      "document.body.innerText.includes('Multica 已确认接收该冻结版本。')",
    )
    await waitForExpression(client, "document.body.innerText.includes('真实远端状态：in-sync')")
    await capture(client, path.join(artifactsRoot, 'packaged-external-multica.png'))
    process.stdout.write('PACKAGED_EXTERNAL_GUI_MULTICA VERIFIED\n')

    const inspected = await invoke('agent', 'inspect', '--project', projectRoot)
    const version = inspected.data?.project?.versions?.at(-1)
    if (!version?.id || !version.contentHash) throw new Error('PACKAGED_EXTERNAL_VERSION_MISSING')
    const cliRetry = await invoke(
      'publish',
      'publish',
      '--project',
      projectRoot,
      '--version',
      version.id,
      '--confirm',
    )
    if (cliRetry.data?.reused !== true || cliRetry.data?.receipt?.status !== 'succeeded') {
      throw new Error('PACKAGED_EXTERNAL_CLI_RETRY_NOT_REUSED')
    }
    const cliStatus = await invoke(
      'publish',
      'status',
      '--project',
      projectRoot,
      '--version',
      version.id,
    )
    const remote = cliStatus.data?.remote
    if (
      remote?.state !== 'in-sync' ||
      !remote.remoteAgentId ||
      remote.localContentHash !== remote.remoteContentHash ||
      guiPackageHashPrefix !== remote.localContentHash.slice(0, 12) ||
      cliRetry.data.receipt.remoteAgentId !== remote.remoteAgentId
    ) {
      throw new Error('PACKAGED_EXTERNAL_GUI_CLI_MULTICA_MISMATCH')
    }
    process.stdout.write('PACKAGED_EXTERNAL_CLI_MULTICA_REUSE VERIFIED\n')

    await navigate(client, '运行', '运行记录')
    await chooseHarness(client, 'OpenClaw', '已选择 OpenClaw。')
    await submitNativeMessage(client, 'chat', 'PACKAGED_OPENCLAW_CHAT_ONE_OK')
    const openClawSessionPrefix = await evaluate(
      client,
      "document.querySelector('.native-execute-actions small')?.textContent ?? ''",
    )
    await submitNativeMessage(client, 'chat', 'PACKAGED_OPENCLAW_CHAT_TWO_OK')
    const openClawResumedPrefix = await evaluate(
      client,
      "document.querySelector('.native-execute-actions small')?.textContent ?? ''",
    )
    if (!openClawSessionPrefix || openClawSessionPrefix !== openClawResumedPrefix) {
      throw new Error('PACKAGED_OPENCLAW_SESSION_NOT_RESUMED')
    }
    await submitNativeMessage(client, 'run', 'PACKAGED_OPENCLAW_RUN_OK')
    process.stdout.write('PACKAGED_EXTERNAL_OPENCLAW VERIFIED\n')
    await capture(client, path.join(artifactsRoot, 'packaged-external-openclaw-native.png'))

    const history = (
      await readFile(path.join(projectRoot, '.agent-stack-local', 'native-history.jsonl'), 'utf8')
    )
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((entry) => entry.result ?? entry)
    const harnessEvidence = ['pi', 'openclaw'].map((harness) => {
      const results = history.filter(
        (result) => result.harness === harness && result.status === 'succeeded',
      )
      const transientFailures = history.filter(
        (result) => result.harness === harness && result.status !== 'succeeded',
      )
      const chats = results.filter((result) => result.kind === 'chat')
      const runs = results.filter((result) => result.kind === 'run')
      if (
        chats.length < 2 ||
        runs.length < 1 ||
        new Set(chats.map(({ sessionId }) => sessionId)).size !== 1 ||
        !results.every(({ modelLayer }) => modelLayer?.kind === 'codex-simulation')
      ) {
        throw new Error(`PACKAGED_EXTERNAL_HISTORY_INVALID:${harness}`)
      }
      return {
        harness,
        harnessVersion: results[0].harnessVersion,
        chatCount: chats.length,
        runCount: runs.length,
        transientFailureCount: transientFailures.length,
        sameChatSession: true,
        modelLayer: 'codex-simulation',
        projectHashRecorded: results.every(({ projectHash }) => /^[a-f0-9]{64}$/.test(projectHash)),
      }
    })
    const doctor = await invoke('doctor', '--project', projectRoot)
    const multicaCheck = doctor.data?.checks?.find(({ id }) => id === 'multica-publish')
    const harnessChecks =
      doctor.data?.checks?.filter(({ category }) => category === 'harness') ?? []
    if (
      multicaCheck?.status !== 'pass' ||
      harnessChecks.length !== 3 ||
      harnessChecks.some(({ status }) => status !== 'pass')
    ) {
      throw new Error('PACKAGED_EXTERNAL_DOCTOR_NOT_READY')
    }

    const evidence = {
      contractVersion: 1,
      generatedAt: new Date().toISOString(),
      application: { packaged: true, architecture: process.arch },
      harnesses: harnessEvidence,
      version: { id: version.id, contentHash: version.contentHash },
      publish: {
        guiValidation: 'ready',
        guiFirstPublish: 'succeeded',
        cliRetryReused: true,
        cliStatus: remote.state,
        packageHash: remote.localContentHash,
        hashesMatch: true,
        sameRemoteIdentity: true,
        remoteAgentFingerprint: createHash('sha256').update(remote.remoteAgentId).digest('hex'),
      },
      doctor: {
        status: doctor.data.status,
        allHarnessesReady: true,
        multicaReady: true,
      },
      screenshots: [
        'artifacts/packaged-external-pi-native.png',
        'artifacts/packaged-external-multica.png',
        'artifacts/packaged-external-openclaw-native.png',
      ],
      privacy: {
        containsLocalPaths: false,
        containsCredentials: false,
        containsRuntimeWorkspaceOrMachineIdentity: false,
        containsPromptsResponsesChatsOrLogs: false,
      },
    }
    await writeFile(
      path.join(artifactsRoot, 'packaged-external-evidence.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    process.stdout.write(
      'PACKAGED_EXTERNAL_E2E VERIFIED (Pi/OpenClaw sessions + GUI/CLI Multica + doctor)\n',
    )
  } finally {
    client?.close()
    if (applicationProcess) await waitForExit(applicationProcess)
    await simulation.close().catch(() => undefined)
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

void main()
