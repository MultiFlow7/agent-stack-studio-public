import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { macosApplicationDirectory } from './package-macos.mjs'

const execute = promisify(execFile)

function registerPortableVersionFixture(databasePath, project, version) {
  const database = new Database(databasePath)
  try {
    const link = database
      .prepare('SELECT agent_id FROM agent_project_links WHERE project_id = ?')
      .get(project.id)
    if (!link?.agent_id) throw new Error('portable Version 夹具找不到本机 Agent 绑定。')
    database
      .prepare(
        `INSERT INTO agent_versions
          (id, agent_id, version_number, snapshot_json, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        link.agent_id,
        version.versionNumber,
        JSON.stringify({
          kind: 'project-reference',
          projectId: project.id,
          projectVersionId: version.id,
          projectRevision: project.revision,
        }),
        version.contentHash,
        version.createdAt,
      )
  } finally {
    database.close()
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (port === null) reject(new Error('无法分配本机 E2E 调试端口。'))
        else resolve(port)
      })
    })
  })
}

async function waitForTarget(port, processState) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (processState.exitCode !== null) {
      throw new Error(`打包应用提前退出（exit ${processState.exitCode}）。${processState.stderr}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        if (page) return page
      }
    } catch {
      // Chromium 的调试端口尚未就绪。
    }
    await delay(100)
  }
  throw new Error('等待打包应用 Renderer 超时。')
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
    socket.addEventListener('error', () => reject(new Error('无法连接 Renderer 调试端点。')), {
      once: true,
    })
  })
  return {
    async send(method, params = {}) {
      await opened
      const id = nextId++
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
      socket.send(JSON.stringify({ id, method, params }))
      return result
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
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? 'Renderer 表达式执行失败。')
  }
  return response.result?.value
}

async function waitForExpression(client, expression) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return
    await delay(100)
  }
  throw new Error(`界面状态等待超时：${expression}`)
}

async function verifyNavigationReachability(client) {
  const destinations = [
    ['Agent', 'Agent'],
    ['组件', '组件'],
    ['运行', '运行记录'],
    ['发布', '发布'],
    ['设置', '设置'],
  ]
  const visited = []
  for (const [label, heading] of destinations) {
    const state = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('nav button')].find(
          (element) => element.getAttribute('aria-label') === ${JSON.stringify(label)}
        )
        if (!button || button.disabled) return { found: Boolean(button), disabled: button?.disabled }
        button.focus()
        button.click()
        return { found: true, disabled: false }
      })()`,
    )
    if (!state.found || state.disabled) {
      throw new Error(`主导航不可达：${label}（${JSON.stringify(state)}）`)
    }
    await waitForExpression(
      client,
      `document.querySelector('h1')?.textContent === ${JSON.stringify(heading)}`,
    )
    const active = await evaluate(
      client,
      `document.querySelector('nav button[aria-current=page]')?.getAttribute('aria-label')`,
    )
    if (active !== label) throw new Error(`主导航未标记当前页面：${label}（实际 ${active}）`)
    visited.push(label)
  }
  return visited
}

async function verifyAccessibilityTree(client) {
  await client.send('Accessibility.enable')
  const { nodes = [] } = await client.send('Accessibility.getFullAXTree')
  const exposed = nodes.filter((node) => !node.ignored)
  const buttonNames = exposed
    .filter((node) => node.role?.value === 'button')
    .map((node) => String(node.name?.value ?? '').trim())
  const requiredNames = [
    'Agent',
    '组件',
    '运行',
    '发布',
    '设置',
    '搜索 Agent、组件、Run…',
    '创建 Agent',
  ]
  const missing = requiredNames.filter((name) => !buttonNames.includes(name))
  const unnamedButtons = buttonNames.filter((name) => !name).length
  const roles = new Set(exposed.map((node) => node.role?.value))
  if (missing.length || unnamedButtons || !roles.has('main') || !roles.has('navigation')) {
    throw new Error(
      `可访问树不完整：${JSON.stringify({ missing, unnamedButtons, hasMain: roles.has('main'), hasNavigation: roles.has('navigation') })}`,
    )
  }
  return { buttonCount: buttonNames.length, unnamedButtons }
}

async function agentCreationSnapshot(userDataPath) {
  const database = new Database(path.join(userDataPath, 'studio.sqlite3'), { readonly: true })
  let databaseState
  try {
    databaseState = {
      agents: database.prepare('SELECT COUNT(*) AS count FROM agents').get().count,
      projectLinks: database.prepare('SELECT COUNT(*) AS count FROM agent_project_links').get()
        .count,
      setupSessions: database.prepare('SELECT COUNT(*) AS count FROM agent_setup_sessions').get()
        .count,
      savedSetups: database
        .prepare("SELECT COUNT(*) AS count FROM agent_setup_sessions WHERE status = 'saved'")
        .get().count,
    }
  } finally {
    database.close()
  }
  const workspaces = await readdir(path.join(userDataPath, 'workspaces')).catch(() => [])
  return { ...databaseState, workspaces: workspaces.sort() }
}

async function captureGuidedAgentSetupEvidence(client, screenshotPath, userDataPath) {
  const before = await agentCreationSnapshot(userDataPath)
  const openBuilder = async () => {
    const opened = await evaluate(
      client,
      `(() => {
        const button = document.querySelector('#create-agent-header')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!opened) throw new Error('打包应用中找不到统一的“创建 Agent”入口。')
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '基本信息'")
    await waitForExpression(
      client,
      'document.activeElement?.matches(\'h1[tabindex="-1"]\') === true',
    )
  }

  await openBuilder()
  const afterOpen = await agentCreationSnapshot(userDataPath)
  if (
    afterOpen.agents !== before.agents ||
    afterOpen.projectLinks !== before.projectLinks ||
    JSON.stringify(afterOpen.workspaces) !== JSON.stringify(before.workspaces) ||
    afterOpen.setupSessions !== before.setupSessions + 1
  ) {
    throw new Error(`打开引导创建时产生了可见空壳：${JSON.stringify({ before, afterOpen })}`)
  }
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.includes('取消创建')
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
  await waitForExpression(
    client,
    "document.body.innerText.includes('已取消创建，没有产生 Agent 或项目。')",
  )
  const afterCancel = await agentCreationSnapshot(userDataPath)
  if (JSON.stringify(afterCancel) !== JSON.stringify(before)) {
    throw new Error(`取消引导创建后本地事实发生变化：${JSON.stringify({ before, afterCancel })}`)
  }

  await openBuilder()
  const draftName = 'Packaged guided setup'
  const entered = await evaluate(
    client,
    `(() => {
      const input = document.querySelector('#setup-agent-name')
      const description = document.querySelector('#setup-agent-description')
      if (!(input instanceof HTMLInputElement) || !(description instanceof HTMLTextAreaElement)) {
        return false
      }
      const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      inputSetter.call(input, ${JSON.stringify(draftName)})
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      textareaSetter.call(description, 'Verify save, exit, reload, and resume in the packaged app.')
      description.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      return true
    })()`,
  )
  if (!entered) throw new Error('引导创建的基本信息输入不可操作。')
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '保存并退出'
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
  await waitForExpression(
    client,
    `document.body.innerText.includes(${JSON.stringify(draftName)}) && document.body.innerText.includes('设置未完成')`,
  )
  const afterSave = await agentCreationSnapshot(userDataPath)
  if (
    afterSave.agents !== before.agents ||
    afterSave.projectLinks !== before.projectLinks ||
    JSON.stringify(afterSave.workspaces) !== JSON.stringify(before.workspaces) ||
    afterSave.setupSessions !== before.setupSessions + 1 ||
    afterSave.savedSetups !== before.savedSetups + 1
  ) {
    throw new Error(`保存设置草稿的本地事实不正确：${JSON.stringify({ before, afterSave })}`)
  }

  await client.send('Page.reload')
  await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
  const resumed = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('.setup-row')].find(
        (element) => element.textContent?.includes(${JSON.stringify(draftName)})
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  if (!resumed) throw new Error('重载后找不到“继续设置”入口。')
  await waitForExpression(client, "document.querySelector('h1')?.textContent === '基本信息'")
  await waitForExpression(
    client,
    `document.querySelector('#setup-agent-name')?.value === ${JSON.stringify(draftName)}`,
  )
  const resumeState = await evaluate(
    client,
    `({
      name: document.querySelector('#setup-agent-name')?.value,
      description: document.querySelector('#setup-agent-description')?.value,
      status: document.querySelector('.agent-builder__masthead .status-label')?.textContent?.trim(),
      activeElement: document.activeElement?.textContent?.trim()
    })`,
  )
  if (
    resumeState.name !== draftName ||
    resumeState.description !== 'Verify save, exit, reload, and resume in the packaged app.' ||
    resumeState.status !== '设置未完成' ||
    resumeState.activeElement !== '基本信息'
  ) {
    throw new Error(`恢复的设置草稿内容或焦点不正确：${JSON.stringify(resumeState)}`)
  }
  const extension = path.extname(screenshotPath)
  const guidedSetupScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-guided-setup-resumed${extension}`
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(guidedSetupScreenshotPath, Buffer.from(screenshot.data, 'base64'))

  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '删除设置草稿'
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
  const afterCleanup = await agentCreationSnapshot(userDataPath)
  if (JSON.stringify(afterCleanup) !== JSON.stringify(before)) {
    throw new Error(`删除设置草稿后本地事实未恢复：${JSON.stringify({ before, afterCleanup })}`)
  }
  return {
    before,
    afterOpen,
    afterCancel,
    afterSave,
    afterCleanup,
    guidedSetupScreenshotPath,
    resumeState,
  }
}

async function runGuidedCompletionTransactionE2e({ executablePath, screenshotPath }) {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'studio-guided-completion-e2e-'))
  const binPath = path.join(userDataPath, 'bin')
  await mkdir(binPath, { recursive: true })
  const piPath = path.join(binPath, 'pi')
  const mcpFixturePath = path.join(binPath, 'studio-fixture-mcp')
  await writeFile(
    piPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '0.84.2\\n'
  exit 0
fi
if [ "$1" = "auth" ]; then
  printf '{"status":"ready","provider":"openai"}\\n'
  exit 0
fi
case "$*" in
  *"Studio 已执行你请求的 MCP 工具"*)
    printf '%s\\n' '{"type":"message_end","message":{"content":[{"type":"text","text":"PACKAGED_PI_MCP_FINAL"}]},"usage":{"input":2,"output":2,"total":4}}'
    ;;
  *"fixture_echo"*)
    printf '%s\\n' '{"type":"message_end","message":{"content":[{"type":"text","text":"<studio-mcp-call>{\\"serverId\\":\\"mcp-server-1\\",\\"name\\":\\"fixture_echo\\",\\"arguments\\":{\\"value\\":\\"packaged-native\\"}}</studio-mcp-call>"}]},"usage":{"input":1,"output":1,"total":2}}'
    ;;
  *)
    printf '%s\\n' '{"type":"message_end","message":{"content":[{"type":"text","text":"MODEL_CONNECTION_OK"}]},"usage":{"input":1,"output":1,"total":2}}'
    ;;
esac
`,
    { encoding: 'utf8', mode: 0o700 },
  )
  await chmod(piPath, 0o700)
  await writeFile(
    mcpFixturePath,
    `#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"packaged-fixture","version":"1"}}}'
      ;;
    *'"method":"tools/list"'*)
      printf '%s\\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"fixture_echo","description":"Packaged inert echo","inputSchema":{"type":"object"}}]}}'
      ;;
    *'"method":"tools/call"'*)
      printf '%s\\n' '{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"fixture:packaged-native"}],"isError":false}}'
      ;;
  esac
done
`,
    { encoding: 'utf8', mode: 0o700 },
  )
  await chmod(mcpFixturePath, 0o700)
  const port = await availablePort()
  const state = { exitCode: null, stderr: '' }
  const child = spawn(
    executablePath,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataPath}`],
    {
      env: {
        ...process.env,
        PATH: `${binPath}${path.delimiter}${process.env.PATH ?? ''}`,
        STUDIO_CAPTURE_USER_DATA_PATH: userDataPath,
        STUDIO_PACKAGED_E2E: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    state.stderr = `${state.stderr}${chunk}`.slice(-4_000)
  })
  child.once('exit', (exitCode) => {
    state.exitCode = exitCode
  })
  let client
  try {
    const target = await waitForTarget(port, state)
    client = createCdpClient(target.webSocketDebuggerUrl)
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
    await evaluate(client, "document.querySelector('#create-agent-header')?.click()")
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '基本信息'")
    const agentName = 'Packaged completed Agent'
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('#setup-agent-name')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(input, ${JSON.stringify(agentName)})
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        return input.value
      })()`,
    )
    await evaluate(
      client,
      `([...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '下一步'
      )?.click())`,
    )
    await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Harness'")
    const selectedHarness = await evaluate(
      client,
      `(() => {
        const label = [...document.querySelectorAll('.agent-builder__choice-list label')].find(
          (element) => element.textContent?.includes('Pi') && element.textContent?.includes('可用')
        )
        label?.querySelector('input')?.click()
        return Boolean(label)
      })()`,
    )
    if (!selectedHarness) throw new Error('受控完成验收中 Pi Harness 不可选。')
    await evaluate(
      client,
      `([...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '下一步'
      )?.click())`,
    )
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '模型'")
    const selectedExistingLogin = await evaluate(
      client,
      `(() => {
        const label = [...document.querySelectorAll('.agent-builder__auth-methods label')].find(
          (element) => element.textContent?.includes('复用 Pi 登录')
        )
        label?.querySelector('input')?.click()
        return Boolean(label)
      })()`,
    )
    if (!selectedExistingLogin) throw new Error('受控完成验收中找不到 Pi 现有登录选项。')
    await evaluate(
      client,
      `([...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '检查现有登录'
      )?.click())`,
    )
    await waitForExpression(client, "document.body.innerText.includes('认证有效')")
    await evaluate(
      client,
      `(() => {
        const checkbox = document.querySelector('.agent-builder__cost-check input')
        checkbox?.click()
        return Boolean(checkbox)
      })()`,
    )
    await evaluate(
      client,
      `([...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '验证模型连接'
      )?.click())`,
    )
    await waitForExpression(client, "document.body.innerText.includes('最小模型调用已通过')")
    await evaluate(
      client,
      `([...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '下一步'
      )?.click())`,
    )
    await waitForExpression(
      client,
      "document.querySelector('h1')?.textContent === '能力（可选增强）'",
    )
    const optionalCapabilityState = await evaluate(
      client,
      `({
        heading: document.querySelector('h1')?.textContent,
        empty: document.body.innerText.includes('这不会阻止创建'),
        selectedCount: document.querySelectorAll('.agent-builder__selected-capabilities > li').length,
        manualEditorOpen: document.querySelector('.agent-builder__advanced-capabilities')?.open === true
      })`,
    )
    if (
      optionalCapabilityState.heading !== '能力（可选增强）' ||
      !optionalCapabilityState.empty ||
      optionalCapabilityState.selectedCount !== 0 ||
      optionalCapabilityState.manualEditorOpen
    ) {
      throw new Error(`空能力完成路径不真实：${JSON.stringify(optionalCapabilityState)}`)
    }
    await evaluate(
      client,
      `([...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '下一步'
      )?.click())`,
    )
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '完成检查'")
    await waitForExpression(client, "document.body.innerText.includes('可以完成创建')")
    const completionClicks = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '完成创建'
        )
        button?.click()
        button?.click()
        return button ? 2 : 0
      })()`,
    )
    if (completionClicks !== 2) throw new Error('受控完成验收中“完成创建”不可操作。')
    await waitForExpression(
      client,
      "document.body.innerText.includes('Agent 已创建 · 开始首次聊天')",
    )
    await waitForExpression(
      client,
      "document.activeElement?.matches('.native-execute-form textarea') === true",
    )
    await waitForExpression(
      client,
      "[...document.querySelectorAll('.native-execute-form button')].find((element) => element.textContent?.trim() === '发送')?.disabled === false && !document.querySelector('.native-readiness-blocker')",
    )
    const workbenchState = await evaluate(
      client,
      `({
        blocker: document.querySelector('.native-readiness-blocker')?.textContent?.trim(),
        alerts: [...document.querySelectorAll('[role=alert]')].map((element) => element.textContent?.trim()),
        nativeRouteNote: document.body.innerText.includes('此 Agent 不使用旧版本地 Run'),
        legacyStartVisible: [...document.querySelectorAll('button')].some(
          (element) => element.textContent?.trim() === '启动本地 Run'
        ),
        sendDisabled: [...document.querySelectorAll('.native-execute-form button')].find(
          (element) => element.textContent?.trim() === '发送'
        )?.disabled
      })`,
    )
    if (
      workbenchState.sendDisabled !== false ||
      workbenchState.blocker ||
      !workbenchState.nativeRouteNote ||
      workbenchState.legacyStartVisible
    ) {
      throw new Error(`完成创建后首次聊天仍不可用：${JSON.stringify(workbenchState)}`)
    }
    const guardedLegacyError = await evaluate(
      client,
      `(async () => {
        const [agent] = await window.studio.agents.list()
        try {
          await window.studio.runs.start({
            agentId: agent.id,
            prompt: '验证 Native-first Main 路由',
            timeoutMs: 5000
          })
          return null
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      })()`,
    )
    if (
      !guardedLegacyError?.includes('Pi Agent 使用 Native Harness 单次运行') ||
      guardedLegacyError.includes('Error invoking remote method') ||
      guardedLegacyError.includes('studio.harness.pi 未绑定')
    ) {
      throw new Error(`Native-first Main 路由或错误净化失效：${guardedLegacyError ?? 'missing'}`)
    }
    await evaluate(
      client,
      `([...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '添加 MCP server'
      )?.click())`,
    )
    await waitForExpression(client, "document.querySelector('.mcp-editor__body') !== null")
    const choseStdio = await evaluate(
      client,
      `(() => {
        const label = [...document.querySelectorAll('.mcp-editor__transport label')].find(
          (element) => element.textContent?.includes('本地 stdio')
        )
        label?.querySelector('input')?.click()
        return Boolean(label)
      })()`,
    )
    if (!choseStdio) throw new Error('打包 Native 工作台中找不到本地 stdio transport。')
    await waitForExpression(
      client,
      "[...document.querySelectorAll('.mcp-editor__body label')].some((element) => element.textContent?.includes('可执行文件'))",
    )
    const mcpSaveState = await evaluate(
      client,
      `(async () => {
        const state = await window.studio.studioProject.current()
        const next = await window.studio.studioProject.updateProfile({
          expectedRevision: state.project.revision,
          profile: {
            ...state.project.profile,
            mcpServers: [{
              id: 'mcp-server-1',
              name: 'Packaged Fixture MCP',
              transport: 'stdio',
              command: ${JSON.stringify(mcpFixturePath)},
              args: [],
              url: null,
              secretReferences: [],
              enabled: true,
              approval: 'approved'
            }]
          }
        })
        const saved = (await window.studio.studioProject.current()).project.profile.mcpServers[0]
        return {
          revision: next.project.revision,
          command: saved.command,
          approval: saved.approval,
          transport: saved.transport
        }
      })()`,
    )
    if (
      mcpSaveState.command !== mcpFixturePath ||
      mcpSaveState.approval !== 'approved' ||
      mcpSaveState.transport !== 'stdio'
    ) {
      throw new Error(`已批准 MCP 投影失效：${JSON.stringify(mcpSaveState)}`)
    }
    await evaluate(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role=tab]')].find(
          (element) => element.textContent?.trim() === '单次运行'
        )
        tab?.click()
        return Boolean(tab)
      })()`,
    )
    const submittedMcpRun = await evaluate(
      client,
      `(() => {
        const input = document.querySelector('.native-execute-form textarea')
        const button = [...document.querySelectorAll('.native-execute-form button')].find(
          (element) => element.textContent?.trim() === '运行一次'
        )
        if (!(input instanceof HTMLTextAreaElement) || !button) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(input, '请通过本地 MCP 调用 fixture_echo。')
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        button.click()
        return true
      })()`,
    )
    if (!submittedMcpRun) throw new Error('打包 Pi Native MCP 单次运行不可操作。')
    await waitForExpression(
      client,
      "document.body.innerText.includes('PACKAGED_PI_MCP_FINAL') && document.body.innerText.includes('Studio 受控 MCP 适配已通过')",
      30_000,
    )
    const mcpRunState = await evaluate(
      client,
      `({
        final: document.body.innerText.includes('PACKAGED_PI_MCP_FINAL'),
        toolEvidence: document.body.innerText.includes('fixture_echo'),
        noLegacyAdapterError: !document.body.innerText.includes('studio.harness.pi 未绑定'),
        noElectronError: !document.body.innerText.includes('Error invoking remote method'),
        transportCopy: document.body.innerText.includes('本地 stdio')
      })`,
    )
    if (
      !mcpRunState.final ||
      !mcpRunState.toolEvidence ||
      !mcpRunState.noLegacyAdapterError ||
      !mcpRunState.noElectronError ||
      !mcpRunState.transportCopy
    ) {
      throw new Error(`打包 Pi Native MCP 证据不完整：${JSON.stringify(mcpRunState)}`)
    }
    const database = new Database(path.join(userDataPath, 'studio.sqlite3'), { readonly: true })
    let stateAfterCompletion
    try {
      stateAfterCompletion = {
        agents: database.prepare('SELECT COUNT(*) AS count FROM agents').get().count,
        projectLinks: database.prepare('SELECT COUNT(*) AS count FROM agent_project_links').get()
          .count,
        setupSessions: database.prepare('SELECT COUNT(*) AS count FROM agent_setup_sessions').get()
          .count,
      }
    } finally {
      database.close()
    }
    const workspaces = await readdir(path.join(userDataPath, 'workspaces')).catch(() => [])
    if (
      stateAfterCompletion.agents !== 1 ||
      stateAfterCompletion.projectLinks !== 1 ||
      stateAfterCompletion.setupSessions !== 0 ||
      workspaces.length !== 1
    ) {
      throw new Error(
        `受控完成交易没有严格产生一个 Agent：${JSON.stringify({ stateAfterCompletion, workspaces })}`,
      )
    }
    const projectText = await readFile(
      path.join(userDataPath, 'workspaces', workspaces[0], '.agent-stack'),
      'utf8',
    )
    if (!projectText.includes(mcpFixturePath) || projectText.includes('private-test-api-key')) {
      throw new Error('打包 MCP 投影或 Secret 边界失效。')
    }
    await mkdir(path.dirname(screenshotPath), { recursive: true })
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
    return {
      agentName,
      screenshotPath,
      stateAfterCompletion,
      workbenchState,
      guardedLegacyError,
      optionalCapabilityState,
      mcpRunState,
      workspaces,
    }
  } finally {
    client?.close()
    if (state.exitCode === null) child.kill('SIGTERM')
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2_000)])
    if (state.exitCode === null) child.kill('SIGKILL')
    await rm(userDataPath, { recursive: true, force: true })
  }
}

async function captureSourceDiscoveryEvidence(client, screenshotPath) {
  await evaluate(
    client,
    `(() => {
      const componentButton = [...document.querySelectorAll('nav button')].find(
        (element) => element.getAttribute('aria-label') === '组件'
      )
      componentButton?.focus()
      componentButton?.click()
      return Boolean(componentButton)
    })()`,
  )
  await waitForExpression(client, "document.querySelector('h1')?.textContent === '组件'")
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '查找公开来源'
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  await waitForExpression(
    client,
    "document.querySelector('h1')?.textContent === '发现组件来源' && document.body.innerText.includes('不下载，不执行代码')",
  )
  await evaluate(
    client,
    `(() => {
      document.querySelector('.discovery-view')?.scrollIntoView({ block: 'start' })
      document.querySelector('[type=search]')?.focus()
      return true
    })()`,
  )
  await delay(200)
  const idleScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  const extension = path.extname(screenshotPath)
  const idleScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-source-discovery-idle${extension}`
  await writeFile(idleScreenshotPath, Buffer.from(idleScreenshot.data, 'base64'))

  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('.customization-source-field input')
      const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      inputSetter?.call(input, 'https://github.com/anthropics/skills')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      const select = [...document.querySelectorAll('.customization-form select')].find(
        (element) => element.previousElementSibling?.textContent?.includes('目标 Harness')
      )
      const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      selectSetter?.call(select, 'codex')
      select?.dispatchEvent(new Event('change', { bubbles: true }))
      return Boolean(input && select)
    })()`,
  )
  await waitForExpression(
    client,
    "document.querySelector('.customization-source-field input')?.value === 'https://github.com/anthropics/skills' && [...document.querySelectorAll('.customization-form select')].some((element) => element.value === 'codex')",
  )
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '静态识别'
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  await waitForExpression(
    client,
    "document.body.innerText.includes('命中 12 个固定方案') && document.querySelectorAll('select[aria-label=\"固定方案\"] option').length === 12 && document.body.innerText.includes('仅说明文件，能力会降级')",
  )
  await evaluate(
    client,
    "document.querySelector('.customization-result')?.scrollIntoView({ block: 'center' })",
  )
  await delay(200)
  const recipeScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  const recipeScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-m36-recipes${extension}`
  await writeFile(recipeScreenshotPath, Buffer.from(recipeScreenshot.data, 'base64'))
  const recipeState = await evaluate(
    client,
    `({
      optionCount: document.querySelectorAll('select[aria-label="固定方案"] option').length,
      hasDegradation: document.body.innerText.includes('仅说明文件，能力会降级'),
      hasSafetyBoundary: document.body.innerText.includes('不执行仓库代码')
    })`,
  )

  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('[type=search]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'a')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '搜索来源'
      )
      button?.focus()
      button?.click()
      return Boolean(input && button)
    })()`,
  )
  await waitForExpression(
    client,
    "document.body.innerText.includes('搜索条件不完整') && document.body.innerText.includes('当前输入没有发送到网络')",
  )
  const failureCopy = await evaluate(
    client,
    "document.querySelector('.state-panel--error')?.textContent?.trim()",
  )
  if (!failureCopy || failureCopy.includes('remote method')) {
    throw new Error(`来源发现错误文案泄漏内部 IPC 信息：${failureCopy ?? 'missing'}`)
  }
  const errorScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  const errorScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-source-discovery-validation-error${extension}`
  await writeFile(errorScreenshotPath, Buffer.from(errorScreenshot.data, 'base64'))
  return { errorScreenshotPath, failureCopy, idleScreenshotPath, recipeScreenshotPath, recipeState }
}

async function captureWorkspaceCommandCenterEvidence(client, screenshotPath) {
  await waitForExpression(
    client,
    "document.querySelector('.workspace-identity')?.textContent?.includes('Packaged CLI E2E') && document.querySelector('.topbar__activity')?.getAttribute('aria-label')?.includes('已完成')",
  )
  await evaluate(
    client,
    `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
        bubbles: true
      }))
      return true
    })()`,
  )
  await waitForExpression(
    client,
    "document.querySelector('[role=dialog] h2')?.textContent === '全局搜索与操作'",
  )
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('.command-palette input[type=search]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '草稿修订')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      input?.focus()
      return Boolean(input)
    })()`,
  )
  await waitForExpression(
    client,
    "document.querySelector('[role=listbox]')?.textContent?.includes('Packaged CLI E2E')",
  )
  const state = await evaluate(
    client,
    `({
      workspace: document.querySelector('.workspace-identity')?.textContent?.trim(),
      activity: document.querySelector('.topbar__activity')?.getAttribute('aria-label'),
      result: document.querySelector('[role=option][aria-selected=true]')?.textContent?.trim(),
      activeElement: document.activeElement?.getAttribute('type')
    })`,
  )
  if (
    !state.workspace?.includes('Packaged CLI E2E') ||
    !state.activity?.includes('已完成') ||
    !state.result?.includes('Packaged CLI E2E') ||
    state.activeElement !== 'search'
  ) {
    throw new Error(`工作区命令中心状态不完整：${JSON.stringify(state)}`)
  }
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  const extension = path.extname(screenshotPath)
  const commandCenterScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-command-center${extension}`
  await writeFile(commandCenterScreenshotPath, Buffer.from(screenshot.data, 'base64'))
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('.command-palette input[type=search]')
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return Boolean(input)
    })()`,
  )
  await waitForExpression(
    client,
    "!document.querySelector('.command-palette') && document.body.innerText.includes('Packaged CLI E2E')",
  )
  return { commandCenterScreenshotPath, state }
}

async function captureRunHistoryEvidence(client, screenshotPath) {
  await evaluate(
    client,
    `(() => {
      const tab = [...document.querySelectorAll('[role=tab]')].find(
        (element) => element.textContent?.trim() === '运行'
      )
      tab?.focus()
      tab?.click()
      return Boolean(tab)
    })()`,
  )
  await waitForExpression(client, "document.body.innerText.includes('启动可复现 Run')")
  await evaluate(
    client,
    `(() => {
      const timeout = document.querySelector('.run-launcher__timeout select')
      const timeoutSetter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value'
      )?.set
      timeoutSetter?.call(timeout, '500')
      timeout?.dispatchEvent(new Event('change', { bubbles: true }))
      const prompt = document.querySelector('.run-launcher__prompt textarea')
      const promptSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )?.set
      promptSetter?.call(prompt, '验证超时后的不可变历史投影')
      prompt?.dispatchEvent(new Event('input', { bubbles: true }))
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '启动本地 Run'
      )
      button?.focus()
      button?.click()
      return Boolean(timeout && prompt && button)
    })()`,
  )
  await waitForExpression(client, "Boolean(document.querySelector('.run-status--timed-out'))")
  const state = await evaluate(
    client,
    `({
      hasSucceeded: Boolean(document.querySelector('.run-status--succeeded')),
      hasTimeoutCode: document.body.innerText.includes('TIMEOUT'),
      hasPrompt: document.body.innerText.includes('验证超时后的不可变历史投影'),
      hasProjection: document.body.innerText.includes('复现变量与 Drift'),
      hasTimeoutVariable: document.body.innerText.includes('500 ms'),
      hasStandaloneDrift: document.body.innerText.includes('不适用')
    })`,
  )
  if (Object.values(state).some((value) => !value)) {
    throw new Error(`Run 历史投影证据不完整：${JSON.stringify(state)}`)
  }
  const runHistoryFailureCopy = await evaluate(
    client,
    "document.querySelector('.run-failure')?.textContent?.trim()",
  )
  if (!runHistoryFailureCopy || runHistoryFailureCopy.includes('remote method')) {
    throw new Error(`Run 超时历史错误文案泄漏内部 IPC 信息：${runHistoryFailureCopy ?? 'missing'}`)
  }
  await evaluate(
    client,
    `(() => {
      document.querySelector('.run-history')?.scrollIntoView({ block: 'center' })
      return true
    })()`,
  )
  await delay(200)
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  const extension = path.extname(screenshotPath)
  const runHistoryScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-run-timeout-history${extension}`
  await writeFile(runHistoryScreenshotPath, Buffer.from(screenshot.data, 'base64'))
  return { runHistoryFailureCopy, runHistoryScreenshotPath }
}

async function captureExperimentMatrixEvidence(client, screenshotPath) {
  const experimentCellCount = 12
  await evaluate(
    client,
    `(() => {
      const tab = [...document.querySelectorAll('[role=tab]')].find(
        (element) => element.textContent?.trim() === '历史与高级'
      )
      tab?.focus()
      tab?.click()
      return Boolean(tab)
    })()`,
  )
  await waitForExpression(
    client,
    "document.body.innerText.includes('Experiment 历史只读') && !document.body.innerText.includes('创建第一个实验')",
  )
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '进入旧版 Experiment 迁移工具'
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  await waitForExpression(client, "document.body.innerText.includes('旧版迁移工具已开启')")
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '创建第一个实验'
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  await waitForExpression(client, "document.body.innerText.includes('定义对照实验')")
  await evaluate(
    client,
    `(() => {
      const field = [...document.querySelectorAll('.experiment-create label')].find(
        (element) => element.textContent?.includes('每组重复次数')
      )
      const select = field?.querySelector('select')
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, '3')
      select?.dispatchEvent(new Event('change', { bubbles: true }))
      return Boolean(select)
    })()`,
  )
  await waitForExpression(
    client,
    `document.querySelector('.experiment-create')?.textContent?.includes('${experimentCellCount} 个运行单元')`,
  )
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '锁定定义并创建矩阵'
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  await waitForExpression(
    client,
    "document.body.innerText.includes('运行矩阵') && document.body.innerText.includes('进度与复现定义')",
  )
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '运行矩阵'
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  await waitForExpression(
    client,
    `(() => {
      const cancel = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '取消实验'
      )
      return Boolean(
        document.querySelector('.cell-status--succeeded') &&
          document.querySelector('.cell-status--running') &&
          cancel &&
          !cancel.disabled
      )
    })()`,
  )
  const requestedCancellation = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === '取消实验'
      )
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`,
  )
  if (!requestedCancellation) throw new Error('Experiment 取消按钮不可用。')
  await waitForExpression(
    client,
    `Boolean(document.querySelector('.experiment-status--cancelled')) && document.querySelectorAll('.cell-status--succeeded, .cell-status--cancelled').length === ${experimentCellCount} && document.querySelectorAll('.cell-status--succeeded').length >= 1 && document.querySelectorAll('.cell-status--cancelled').length >= 1`,
  )
  const outcome = await evaluate(
    client,
    `({
      succeeded: document.querySelectorAll('.cell-status--succeeded').length,
      cancelled: document.querySelectorAll('.cell-status--cancelled').length
    })`,
  )
  if (
    outcome.succeeded < 1 ||
    outcome.cancelled < 1 ||
    outcome.succeeded + outcome.cancelled !== experimentCellCount
  ) {
    throw new Error(`Experiment 取消后没有形成部分结果：${JSON.stringify(outcome)}`)
  }
  await evaluate(
    client,
    `(() => {
      const select = document.querySelector('[aria-label="矩阵状态范围"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, 'issues')
      select?.dispatchEvent(new Event('change', { bubbles: true }))
      return Boolean(select)
    })()`,
  )
  await waitForExpression(
    client,
    `document.body.innerText.includes('显示 ${outcome.cancelled} / ${experimentCellCount} 个单元')`,
  )
  const state = await evaluate(
    client,
    `({
      hasCancelledStatus: document.body.innerText.includes('已取消'),
      hasTerminalProgress: document.body.innerText.includes('${experimentCellCount} / ${experimentCellCount}'),
      hasOutcomeSummary: document.body.innerText.includes('${outcome.succeeded} / ${outcome.cancelled}'),
      hasSuccessRate: document.body.innerText.includes('${Math.round((outcome.succeeded / experimentCellCount) * 100)}%'),
      hasDefinition: document.body.innerText.includes('runtime-duration-v1'),
      hasDrift: document.body.innerText.includes('Drift Check 通过'),
      hasFailureReason: document.body.innerText.includes('实验已取消。'),
      hasIssueFilter: document.body.innerText.includes('显示 ${outcome.cancelled} / ${experimentCellCount} 个单元')
    })`,
  )
  if (Object.values(state).some((value) => !value)) {
    throw new Error(`Experiment 矩阵可观测性证据不完整：${JSON.stringify(state)}`)
  }
  await evaluate(
    client,
    `(() => {
      document.querySelector('.experiment-evidence-summary')?.scrollIntoView({ block: 'start' })
      return true
    })()`,
  )
  await delay(200)
  const extension = path.extname(screenshotPath)
  const matrixScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  const experimentMatrixScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-experiment-partial-matrix${extension}`
  await writeFile(experimentMatrixScreenshotPath, Buffer.from(matrixScreenshot.data, 'base64'))

  await evaluate(
    client,
    `(() => {
      document.querySelector('.experiment-comparison')?.scrollIntoView({ block: 'center' })
      return true
    })()`,
  )
  await waitForExpression(
    client,
    `(() => {
      const rows = [...document.querySelectorAll('.experiment-comparison tbody tr')]
      const succeededRuns = rows.reduce((total, row) => {
        const match = row.querySelector('td:nth-child(2)')?.textContent?.match(/\\((\\d+)\\/${experimentCellCount / 4}\\)/)
        return total + Number(match?.[1] ?? 0)
      }, 0)
      return document.body.innerText.includes('基础对比') &&
        document.body.innerText.includes('相对基准') &&
        rows.length === 4 &&
        succeededRuns === ${outcome.succeeded}
    })()`,
  )
  await delay(200)
  const comparisonScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  const experimentComparisonScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-experiment-relative-baseline${extension}`
  await writeFile(
    experimentComparisonScreenshotPath,
    Buffer.from(comparisonScreenshot.data, 'base64'),
  )
  return { experimentComparisonScreenshotPath, experimentMatrixScreenshotPath, outcome, state }
}

async function verifyPackagedCli({ applicationPath, projectPath, fixturePath }) {
  const cliPath = path.join(applicationPath, 'Contents', 'Resources', 'bin', 'studio')
  const packageJson = JSON.parse(await readFile(path.join(projectPath, 'package.json'), 'utf8'))
  const invoke = async (...args) => {
    const { stdout, stderr } = await execute(cliPath, [...args, '--json'], {
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    })
    if (stderr.trim()) throw new Error(`打包 CLI 意外写入 stderr：${stderr.trim()}`)
    return JSON.parse(stdout)
  }
  const invokeFailure = async (...args) => {
    try {
      await execute(cliPath, [...args, '--json'], {
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      })
    } catch (error) {
      const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
      if (stderr) return JSON.parse(stderr)
      throw error
    }
    throw new Error(`打包 CLI 命令意外成功：${args.join(' ')}`)
  }

  const version = await invoke('--version')
  if (!version.ok || version.data?.version !== packageJson.version) {
    throw new Error(`打包 CLI 版本不一致：${JSON.stringify(version)}`)
  }
  const recipeCatalog = await invoke('customize', 'list', '--harness', 'codex')
  if (
    !recipeCatalog.ok ||
    recipeCatalog.data?.recipes?.length !== 12 ||
    !recipeCatalog.data.recipes.every(
      (recipe) =>
        recipe.commit === '3b3fad96af16a10759d930941b4520ba0c40edae' &&
        recipe.platforms.includes(`darwin-${process.arch}`) &&
        recipe.harnessSupport.some(({ harnessId }) => harnessId === 'codex'),
    )
  ) {
    throw new Error(`打包 CLI M36 固定方案目录异常：${JSON.stringify(recipeCatalog)}`)
  }
  const nativeFixturePath = `${fixturePath}-native`
  const nativeInitialized = await invoke(
    'agent',
    'create',
    nativeFixturePath,
    '--name',
    'Packaged Native Agent',
  )
  if (
    !nativeInitialized.ok ||
    nativeInitialized.data?.project?.stack?.executionMode !== 'external-harness' ||
    nativeInitialized.notices?.length
  ) {
    throw new Error(`打包 CLI Native Agent 创建边界异常：${JSON.stringify(nativeInitialized)}`)
  }
  const initialized = await invoke(
    'project',
    'init',
    fixturePath,
    '--name',
    'Packaged CLI E2E',
    '--execution-mode',
    'hybrid',
  )
  if (
    !initialized.ok ||
    initialized.data?.project?.name !== 'Packaged CLI E2E' ||
    initialized.data?.project?.stack?.executionMode !== 'hybrid' ||
    initialized.notices?.[0]?.code !== 'DEPRECATED_COMMAND'
  ) {
    throw new Error(`打包 CLI 显式旧项目迁移入口异常：${JSON.stringify(initialized)}`)
  }
  const inspected = await invoke('agent', 'inspect', '--project', fixturePath)
  if (
    !inspected.ok ||
    inspected.data?.project?.name !== 'Packaged CLI E2E' ||
    inspected.data?.project?.formatVersion !== 2 ||
    inspected.data?.integrity?.status !== 'verified' ||
    inspected.data?.recovered !== false ||
    inspected.suggestedActions?.length !== 0
  ) {
    throw new Error(`打包 CLI 项目审计结果异常：${JSON.stringify(inspected)}`)
  }
  const doctor = await invoke('doctor', '--project', fixturePath)
  const cliDistribution = doctor.data?.checks?.find(({ id }) => id === 'cli-distribution')
  const projectIntegrity = doctor.data?.checks?.find(({ id }) => id === 'project-integrity')
  if (
    !doctor.ok ||
    doctor.command !== 'doctor' ||
    doctor.data?.schemaVersion !== 1 ||
    cliDistribution?.status !== 'pass' ||
    cliDistribution?.facts?.bundledCliRuntime !== true ||
    projectIntegrity?.status !== 'pass' ||
    doctor.data?.checks?.filter(({ category }) => category === 'harness').length !== 3
  ) {
    throw new Error(`打包 CLI Doctor 结果异常：${JSON.stringify(doctor)}`)
  }
  const legacyInspected = await invoke('project', 'inspect', '--project', fixturePath)
  if (
    !legacyInspected.ok ||
    legacyInspected.data?.project?.id !== inspected.data.project.id ||
    legacyInspected.data?.project?.revision !== inspected.data.project.revision ||
    legacyInspected.notices?.[0]?.code !== 'DEPRECATED_COMMAND' ||
    legacyInspected.notices?.[0]?.replacement !== 'studio agent inspect'
  ) {
    throw new Error(`打包 CLI 兼容迁移提示异常：${JSON.stringify(legacyInspected)}`)
  }
  const portablePackagePath = path.join(fixturePath, 'cli.agent-stack-package.json')
  const exported = await invoke(
    'project',
    'export',
    '--project',
    fixturePath,
    '--output',
    portablePackagePath,
  )
  const portablePackage = JSON.parse(await readFile(portablePackagePath, 'utf8'))
  const { contentHash, ...withoutHash } = portablePackage
  const actualHash = createHash('sha256').update(JSON.stringify(withoutHash)).digest('hex')
  if (
    !exported.ok ||
    exported.data?.status !== 'exported' ||
    exported.data?.packageHash !== contentHash ||
    contentHash !== actualHash ||
    portablePackage.producer?.version !== version.data.version ||
    portablePackage.project?.id !== inspected.data.project.id ||
    portablePackage.excludedContent?.length !== 6
  ) {
    throw new Error(`打包 CLI 导出包无效：${JSON.stringify({ exported, portablePackage })}`)
  }
  return {
    cliPath,
    version: version.data.version,
    fixturePath,
    projectId: inspected.data.project.id,
    projectFormatVersion: inspected.data.project.formatVersion,
    portablePackagePath,
    portablePackage,
    recipeCount: recipeCatalog.data.recipes.length,
    doctorStatus: doctor.data.status,
    invoke,
    invokeFailure,
  }
}

export async function runPackagedAppE2e(options = {}) {
  if (process.platform !== 'darwin') throw new Error('打包应用 E2E 仅在 macOS 上运行。')
  const projectPath = path.resolve(options.projectPath ?? '.')
  const applicationPath = path.resolve(
    options.applicationPath ??
      path.join(
        projectPath,
        'release',
        macosApplicationDirectory(process.arch),
        'Agent Stack Studio.app',
      ),
  )
  const executablePath = path.join(applicationPath, 'Contents', 'MacOS', 'Agent Stack Studio')
  const screenshotPath = path.resolve(
    options.screenshotPath ??
      process.env.STUDIO_E2E_SCREENSHOT ??
      path.join(projectPath, 'artifacts', 'packaged-app-e2e.png'),
  )
  const screenshotExtension = path.extname(screenshotPath)
  const guidedCompletionScreenshotPath = `${screenshotPath.slice(0, -screenshotExtension.length)}-guided-completed${screenshotExtension}`
  const guidedCompletionEvidence = await runGuidedCompletionTransactionE2e({
    executablePath,
    screenshotPath: guidedCompletionScreenshotPath,
  })
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'studio-packaged-e2e-'))
  const packagedCli = await verifyPackagedCli({
    applicationPath,
    projectPath,
    fixturePath: path.join(userDataPath, 'packaged-cli-project'),
  })
  const port = Number(options.port ?? (await availablePort()))
  const packagedGuiExportPath = path.join(userDataPath, 'gui.agent-stack-package.json')
  const applicationArguments = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataPath}`,
    '--project',
    packagedCli.fixturePath,
  ]
  const applicationEnvironment = {
    ...process.env,
    STUDIO_CAPTURE_USER_DATA_PATH: userDataPath,
    STUDIO_PACKAGED_E2E: '1',
    STUDIO_E2E_PROJECT_EXPORT_PATH: packagedGuiExportPath,
  }
  const launchApplication = () => {
    const state = { exitCode: null, stderr: '' }
    const applicationProcess = spawn(executablePath, applicationArguments, {
      env: applicationEnvironment,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    applicationProcess.stderr.setEncoding('utf8')
    applicationProcess.stderr.on('data', (chunk) => {
      state.stderr = `${state.stderr}${chunk}`.slice(-4_000)
    })
    applicationProcess.once('exit', (exitCode) => {
      state.exitCode = exitCode
    })
    return { child: applicationProcess, processState: state }
  }
  let launchedApplication = launchApplication()
  let child = launchedApplication.child
  let processState = launchedApplication.processState

  let client
  try {
    const target = await waitForTarget(port, processState)
    client = createCdpClient(target.webSocketDebuggerUrl)
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")

    const rendererBoundary = await evaluate(
      client,
      `({
        processType: typeof process,
        requireType: typeof require,
        hasStudioBridge: typeof window.studio === 'object',
        language: document.documentElement.lang,
        title: document.title
      })`,
    )
    if (
      rendererBoundary.processType !== 'undefined' ||
      rendererBoundary.requireType !== 'undefined' ||
      !rendererBoundary.hasStudioBridge ||
      rendererBoundary.language !== 'zh-CN'
    ) {
      throw new Error(`Renderer 安全或语言边界不符合预期：${JSON.stringify(rendererBoundary)}`)
    }

    const reachableNavigation = await verifyNavigationReachability(client)
    const accessibilityTree = await verifyAccessibilityTree(client)

    const collapsedSidebar = await evaluate(
      client,
      `(() => {
        const button = document.querySelector('button[aria-label="收起侧边栏"]')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!collapsedSidebar) throw new Error('打包应用中找不到侧边栏偏好操作。')
    await waitForExpression(
      client,
      "document.querySelector('.app-shell')?.classList.contains('app-shell--sidebar-collapsed')",
    )

    const openedSettings = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '设置'
        )
        if (!button) return false
        button.focus()
        button.click()
        return true
      })()`,
    )
    if (!openedSettings) throw new Error('打包应用中找不到“设置”导航。')
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '设置'")
    await waitForExpression(
      client,
      "document.body.innerText.includes('创建备份') && document.body.innerText.includes('密钥原文与日志不会进入备份') && document.body.innerText.includes('存储与卸载边界')",
    )
    await delay(250)
    await client.send('Page.reload')
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '设置'")
    await waitForExpression(
      client,
      "document.querySelector('.app-shell')?.classList.contains('app-shell--sidebar-collapsed')",
    )
    const persistedPreferences = await evaluate(
      client,
      `({
        heading: document.querySelector('h1')?.textContent,
        sidebarCollapsed: document.querySelector('.app-shell')?.classList.contains('app-shell--sidebar-collapsed'),
        expandAction: Boolean(document.querySelector('button[aria-label="展开侧边栏"]'))
      })`,
    )
    if (
      persistedPreferences.heading !== '设置' ||
      !persistedPreferences.sidebarCollapsed ||
      !persistedPreferences.expandAction
    ) {
      throw new Error(`打包界面偏好未在重载后恢复：${JSON.stringify(persistedPreferences)}`)
    }
    const preferencesScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    await evaluate(
      client,
      `(() => {
        const button = document.querySelector('button[aria-label="展开侧边栏"]')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "!document.querySelector('.app-shell')?.classList.contains('app-shell--sidebar-collapsed')",
    )
    const settingsCopy = await evaluate(
      client,
      `({
        heading: document.querySelector('h1')?.textContent,
        hasBackup: document.body.innerText.includes('创建备份'),
        hasKeychainBoundary: document.body.innerText.includes('密钥原文与日志不会进入备份'),
        hasStorageBoundary: document.body.innerText.includes('存储与卸载边界'),
        hasUninstallBoundary: document.body.innerText.includes('卸载应用不会删除这些数据'),
        finderActions: [...document.querySelectorAll('button')].filter(
          (element) => element.getAttribute('aria-label')?.startsWith('在 Finder 中显示 ')
        ).length,
        activeElement: document.activeElement?.textContent?.trim()
      })`,
    )
    if (
      !settingsCopy.hasBackup ||
      !settingsCopy.hasKeychainBoundary ||
      !settingsCopy.hasStorageBoundary ||
      !settingsCopy.hasUninstallBoundary ||
      settingsCopy.finderActions !== 6
    ) {
      throw new Error(`中文设置页内容不完整：${JSON.stringify(settingsCopy)}`)
    }

    const ranDoctor = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '运行完整诊断'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!ranDoctor) throw new Error('打包应用中找不到 Studio Doctor 操作。')
    await waitForExpression(
      client,
      "document.querySelector('.doctor-report') && document.body.innerText.includes('包内 CLI') && document.body.innerText.includes('studio CLI 可执行')",
      30_000,
    )
    const doctorState = await evaluate(
      client,
      `(() => ({
        result: document.querySelector('.doctor-report .maintenance-feedback strong')?.textContent?.trim(),
        checks: document.querySelectorAll('.doctor-checks > li').length,
        cliPassed: [...document.querySelectorAll('.doctor-checks > li')].some(
          (element) => element.textContent?.includes('包内 CLI') && element.textContent?.includes('通过')
        ),
        hasMulticaCheck: [...document.querySelectorAll('.doctor-checks > li')].some(
          (element) => element.textContent?.includes('Multica 发布')
        )
      }))()`,
    )
    if (doctorState.checks < 9 || !doctorState.cliPassed || !doctorState.hasMulticaCheck) {
      throw new Error(`打包 GUI Doctor 结果异常：${JSON.stringify(doctorState)}`)
    }
    await evaluate(
      client,
      "document.querySelector('.doctor-report')?.scrollIntoView({ block: 'start' })",
    )
    const doctorScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })

    const loadedDemoData = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '加载演示数据'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!loadedDemoData) throw new Error('打包应用中找不到“加载演示数据”。')
    await waitForExpression(client, "document.body.innerText.includes('已加载 3 个本地演示组件')")
    const demoFeedbackLayout = await evaluate(
      client,
      `(() => {
        const feedback = [...document.querySelectorAll('.maintenance-feedback')].find(
          (element) => element.textContent?.includes('已加载 3 个本地演示组件')
        )
        const text = feedback?.querySelector('span')
        const rect = text?.getBoundingClientRect()
        return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
      })()`,
    )
    if (demoFeedbackLayout.width < 160 || demoFeedbackLayout.height > 80) {
      throw new Error(`演示数据成功反馈出现异常换行：${JSON.stringify(demoFeedbackLayout)}`)
    }

    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    await mkdir(path.dirname(screenshotPath), { recursive: true })
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
    const preferencesExtension = path.extname(screenshotPath)
    const preferencesScreenshotPath = `${screenshotPath.slice(0, -preferencesExtension.length)}-preferences${preferencesExtension}`
    await writeFile(preferencesScreenshotPath, Buffer.from(preferencesScreenshot.data, 'base64'))
    const doctorScreenshotPath = `${screenshotPath.slice(0, -preferencesExtension.length)}-doctor${preferencesExtension}`
    await writeFile(doctorScreenshotPath, Buffer.from(doctorScreenshot.data, 'base64'))

    const focusedDataLocations = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.getAttribute('aria-label') === '在 Finder 中显示 Application Support'
        )
        button?.closest('.maintenance-section')?.scrollIntoView({ block: 'start' })
        button?.focus()
        return Boolean(button)
      })()`,
    )
    if (!focusedDataLocations) throw new Error('打包应用中找不到数据位置键盘操作。')
    const dataLocationsScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const dataLocationsExtension = path.extname(screenshotPath)
    const dataLocationsScreenshotPath = `${screenshotPath.slice(0, -dataLocationsExtension.length)}-data-locations${dataLocationsExtension}`
    await writeFile(
      dataLocationsScreenshotPath,
      Buffer.from(dataLocationsScreenshot.data, 'base64'),
    )

    const sourceDiscoveryEvidence = await captureSourceDiscoveryEvidence(client, screenshotPath)

    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === 'Agent'
        )
        if (!button) return false
        button.focus()
        button.click()
        return true
      })()`,
    )
    await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
    const guidedSetupEvidence = await captureGuidedAgentSetupEvidence(
      client,
      screenshotPath,
      userDataPath,
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.agent-row')].find(
          (element) => element.textContent?.includes('Packaged CLI E2E')
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('h1')?.textContent === 'Packaged CLI E2E'",
    )

    await evaluate(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role=tab]')].find(
          (element) => element.textContent?.trim() === 'Harness 与组件'
        )
        tab?.focus()
        tab?.click()
        return Boolean(tab)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('#stack-editor-heading')?.textContent?.includes('Harness 与组件')",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) =>
            element.textContent?.trim() === '添加组件' ||
            element.textContent?.trim() === '添加第一个组件'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('添加 本地 Harness X')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '添加 本地 Harness X'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('Stack/兼容性 就绪')")

    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '添加组件'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('添加 旧版 Memory Adapter')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '添加 旧版 Memory Adapter'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('Stack/兼容性 已阻断')")

    await evaluate(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role=tab]')].find(
          (element) => element.textContent?.trim() === '能力'
        )
        tab?.focus()
        tab?.click()
        return Boolean(tab)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('Adapter / Fork 处置任务') && document.body.innerText.includes('1 项待完成') && document.body.innerText.includes('最小运行验证')",
    )
    await evaluate(
      client,
      `(() => {
        const summaries = document.querySelectorAll('[aria-label="兼容性处置任务"] summary')
        const summary = summaries[summaries.length - 1]
        summary?.focus()
        summary?.click()
        return Boolean(summary)
      })()`,
    )
    const remediationCopy = await evaluate(
      client,
      `({
        hasGeneratedEvidence: document.body.innerText.includes('Adapter 已有契约测试证据'),
        hasContractEvidence: document.body.innerText.includes('Descriptor 已记录契约测试证据'),
        hasRuntimeBoundary: document.body.innerText.includes('精确白名单 Runtime Adapter'),
        doesNotAutoExecute: document.body.innerText.includes('不会自动生成、加载或执行第三方代码')
      })`,
    )
    if (
      !remediationCopy.hasGeneratedEvidence ||
      !remediationCopy.hasContractEvidence ||
      !remediationCopy.hasRuntimeBoundary ||
      !remediationCopy.doesNotAutoExecute
    ) {
      throw new Error(`Adapter 处置任务内容不完整：${JSON.stringify(remediationCopy)}`)
    }
    await evaluate(
      client,
      `(() => {
        const section = document.querySelector('[aria-label="兼容性处置任务"]')
        section?.scrollIntoView({ block: 'start' })
        const summaries = section?.querySelectorAll('summary')
        summaries?.[summaries.length - 1]?.focus()
        return Boolean(section)
      })()`,
    )
    const capabilityExtension = path.extname(screenshotPath)
    const remediationScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    const remediationScreenshotPath = `${screenshotPath.slice(0, -capabilityExtension.length)}-adapter-remediation${capabilityExtension}`
    await writeFile(remediationScreenshotPath, Buffer.from(remediationScreenshot.data, 'base64'))

    await evaluate(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role=tab]')].find(
          (element) => element.textContent?.trim() === 'Harness 与组件'
        )
        tab?.focus()
        tab?.click()
        return Boolean(tab)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('旧版 Memory Adapter')")
    await evaluate(
      client,
      `(() => {
        const button = document.querySelector('[aria-label="从 Agent 移除 旧版 Memory Adapter"]')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('Stack/兼容性 就绪')")
    await evaluate(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role=tab]')].find(
          (element) => element.textContent?.trim() === '能力'
        )
        tab?.focus()
        tab?.click()
        return Boolean(tab)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('能力与实现来源')")
    const capabilityCopy = await evaluate(
      client,
      `({
        hasController: document.body.innerText.includes('执行控制'),
        hasImplementation: document.body.innerText.includes('当前实现'),
        hasEvidence: document.body.innerText.includes('已验证兼容')
      })`,
    )
    if (
      !capabilityCopy.hasController ||
      !capabilityCopy.hasImplementation ||
      !capabilityCopy.hasEvidence
    ) {
      throw new Error(`能力页内容不完整：${JSON.stringify(capabilityCopy)}`)
    }
    const capabilityScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    const capabilityScreenshotPath = `${screenshotPath.slice(0, -capabilityExtension.length)}-capabilities${capabilityExtension}`
    await writeFile(capabilityScreenshotPath, Buffer.from(capabilityScreenshot.data, 'base64'))

    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '冻结 Agent Version'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "Boolean(document.querySelector('[role=alert]')) && document.body.innerText.includes('前往模型与认证')",
    )
    const modelAuthBlockedScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const modelAuthBlockedScreenshotPath = `${screenshotPath.slice(0, -capabilityExtension.length)}-model-auth-freeze-blocked${capabilityExtension}`
    await writeFile(
      modelAuthBlockedScreenshotPath,
      Buffer.from(modelAuthBlockedScreenshot.data, 'base64'),
    )

    // 后续旧验收仍需要不可变版本引用；这里显式使用底层 portable Stack freeze
    // 构造测试夹具，不把它记作模型认证或 Agent 就绪证据。
    const portableFrozen = await packagedCli.invoke(
      'stack',
      'freeze',
      '--project',
      packagedCli.fixturePath,
    )
    if (!portableFrozen.ok || portableFrozen.data?.version?.versionNumber !== 1) {
      throw new Error(`打包 E2E portable freeze 夹具失败：${JSON.stringify(portableFrozen)}`)
    }
    registerPortableVersionFixture(
      path.join(userDataPath, 'studio.sqlite3'),
      portableFrozen.data.result.project,
      portableFrozen.data.version,
    )
    await client.send('Page.reload')
    await waitForExpression(client, "Boolean(document.querySelector('.app-shell'))")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === 'Agent'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.agent-row')].find(
          (element) => element.textContent?.includes('Packaged CLI E2E')
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('h1')?.textContent === 'Packaged CLI E2E'",
    )

    await evaluate(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role=tab]')].find(
          (element) => element.textContent?.trim() === '运行'
        )
        tab?.focus()
        tab?.click()
        return Boolean(tab)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('混合模式') && document.body.innerText.includes('显式交接给 Agent Loop')",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '启动本地 Run'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "Boolean(document.querySelector('.run-status--succeeded')) && document.body.innerText.includes('Workflow 70000000 → Agent Loop')",
    )
    const runtimeScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    const screenshotExtension = path.extname(screenshotPath)
    const runtimeScreenshotPath = `${screenshotPath.slice(0, -screenshotExtension.length)}-runtime${screenshotExtension}`
    await writeFile(runtimeScreenshotPath, Buffer.from(runtimeScreenshot.data, 'base64'))
    const commandCenterEvidence = await captureWorkspaceCommandCenterEvidence(
      client,
      screenshotPath,
    )

    await evaluate(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role=tab]')].find(
          (element) => element.textContent?.trim() === '概览'
        )
        tab?.focus()
        tab?.click()
        return Boolean(tab)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('Stack/兼容性') && document.body.innerText.includes('就绪') && document.body.innerText.includes('1 个组件') && document.body.innerText.includes('最近 Run') && document.body.innerText.includes('已完成') && document.body.innerText.includes('尚未发布')",
    )
    const agentStatusScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    const agentStatusScreenshotPath = `${screenshotPath.slice(0, -screenshotExtension.length)}-agent-status${screenshotExtension}`
    await writeFile(agentStatusScreenshotPath, Buffer.from(agentStatusScreenshot.data, 'base64'))

    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '返回全部 Agent'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "Boolean([...document.querySelectorAll('.agent-row')].find((element) => element.textContent?.includes('Packaged CLI E2E') && element.textContent?.includes('版本 1') && element.textContent?.includes('Stack/兼容性：就绪') && element.textContent?.includes('最近 Run：已完成') && element.textContent?.includes('发布：未发布')))",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.nav-item')].find(
          (element) => element.textContent?.trim() === '组件'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('h1')?.textContent === '组件' && document.body.innerText.includes('本地 Harness X') && document.body.innerText.includes('1 个 Agent 草稿') && document.body.innerText.includes('1 个不可变版本')",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.catalog-component-link')].find(
          (element) => element.textContent?.includes('本地 Harness X')
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('Manifest 与来源') && document.body.innerText.includes('当前使用方与受影响版本') && document.body.innerText.includes('Packaged CLI E2E') && document.body.innerText.includes('版本 1')",
    )
    await evaluate(
      client,
      `(() => {
        const summary = [...document.querySelectorAll('summary')].find(
          (element) => element.textContent?.trim() === '查看工程证据'
        )
        summary?.focus()
        summary?.click()
        return Boolean(summary)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('Adapter / Fork 状态') && document.body.innerText.includes('契约测试与来源证据')",
    )
    const componentDetailScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const componentDetailScreenshotPath = `${screenshotPath.slice(0, -screenshotExtension.length)}-component-detail${screenshotExtension}`
    await writeFile(
      componentDetailScreenshotPath,
      Buffer.from(componentDetailScreenshot.data, 'base64'),
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.nav-item')].find(
          (element) => element.textContent?.trim() === 'Agent'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.agent-row')].find(
          (element) => element.textContent?.includes('Packaged CLI E2E')
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('h1')?.textContent === 'Packaged CLI E2E'",
    )

    const { runHistoryFailureCopy, runHistoryScreenshotPath } = await captureRunHistoryEvidence(
      client,
      screenshotPath,
    )
    const experimentEvidence = await captureExperimentMatrixEvidence(client, screenshotPath)

    await evaluate(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role=tab]')].find(
          (element) => element.textContent?.trim() === '设置'
        )
        tab?.focus()
        tab?.click()
        return Boolean(tab)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('#secret-references-title')?.textContent === '高级密钥引用'",
    )
    await evaluate(
      client,
      `(() => {
        document.querySelector('#secret-references-title')?.scrollIntoView({ block: 'start' })
        document.querySelector('#secret-label')?.focus()
        return true
      })()`,
    )
    await delay(200)
    const keychainScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    const extension = path.extname(screenshotPath)
    const keychainScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-keychain${extension}`
    await writeFile(keychainScreenshotPath, Buffer.from(keychainScreenshot.data, 'base64'))

    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '归档'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('Agent 已归档')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '查看已归档'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('Packaged CLI E2E')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.agent-row')].find(
          (element) => element.textContent?.includes('Packaged CLI E2E')
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('恢复 Agent')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '永久删除'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('不能撤销')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.danger-confirmation button')].find(
          (element) => element.textContent?.trim() === '取消'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('恢复 Agent')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '恢复 Agent'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('Agent 已恢复到本地 Agent 列表')",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.agent-row')].find(
          (element) => element.textContent?.includes('Packaged CLI E2E')
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('h1')?.textContent === 'Packaged CLI E2E'",
    )

    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '返回全部 Agent'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('Packaged CLI E2E')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.agent-row')].find(
          (element) => element.textContent?.includes('Packaged CLI E2E')
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('h1')?.textContent === 'Packaged CLI E2E'",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '归档'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('Agent 已归档')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '查看已归档'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "Boolean(document.querySelector('.agent-row'))")
    await evaluate(
      client,
      `(() => {
        const button = document.querySelector('.agent-row')
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('永久删除')")
    await evaluate(
      client,
      `(() => {
        const open = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '永久删除'
        )
        open?.click()
        return Boolean(open)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('不能撤销')")
    await evaluate(
      client,
      `(() => {
        const confirm = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '永久删除此 Agent'
        )
        confirm?.focus()
        confirm?.click()
        return Boolean(confirm)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('仍有历史引用') && document.body.innerText.includes('不可变版本')",
    )
    const lifecycleErrorCopy = await evaluate(
      client,
      "document.querySelector('.detail-feedback--error')?.textContent?.trim()",
    )
    if (!lifecycleErrorCopy || lifecycleErrorCopy.includes('remote method')) {
      throw new Error(`Agent 历史引用错误文案泄漏内部 IPC 信息：${lifecycleErrorCopy ?? 'missing'}`)
    }
    const lifecycleScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    const lifecycleScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-agent-lifecycle${extension}`
    await writeFile(lifecycleScreenshotPath, Buffer.from(lifecycleScreenshot.data, 'base64'))
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '恢复 Agent'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('Agent 已恢复到本地 Agent 列表')",
    )

    const portableStartingState = await packagedCli.invoke(
      'project',
      'inspect',
      '--project',
      packagedCli.fixturePath,
    )
    const portableBaseRevision = portableStartingState.data?.project?.revision
    if (!portableStartingState.ok || !Number.isInteger(portableBaseRevision)) {
      throw new Error(
        `打包 CLI 无法读取 Agent 项目起始 revision：${JSON.stringify(portableStartingState)}`,
      )
    }

    const openedProjectSettings = await evaluate(
      client,
      `(() => {
        const button = document.querySelector('.workspace-identity')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!openedProjectSettings) throw new Error('打包应用中找不到当前项目入口。')
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '项目设置'")
    await waitForExpression(
      client,
      `document.body.innerText.includes('Packaged CLI E2E') && document.body.innerText.includes('revision ${portableBaseRevision}')`,
    )

    const componentSourcePath = path.join(projectPath, 'src', 'test', 'fixtures', 'm7', 'detected')
    const imported = await packagedCli.invoke(
      'component',
      'import',
      componentSourcePath,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision),
    )
    const importedComponent = imported.data?.project?.components?.find(
      ({ descriptor }) => descriptor.id === 'detected.fixture',
    )
    if (
      !imported.ok ||
      imported.data?.project?.revision !== portableBaseRevision + 1 ||
      importedComponent?.descriptor?.name !== 'detected-fixture'
    ) {
      throw new Error(`打包 CLI 外部导入结果异常：${JSON.stringify(imported)}`)
    }
    await waitForExpression(
      client,
      `document.body.innerText.includes('检测到外部修改，已刷新到 revision ${portableBaseRevision + 1}')`,
    )

    const exportedFromGui = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '导出可移植包'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!exportedFromGui) throw new Error('打包应用中找不到“导出可移植包”操作。')
    await waitForExpression(client, "document.body.innerText.includes('已导出可移植包')")
    const cliExportAtSameRevision = await packagedCli.invoke(
      'project',
      'export',
      '--project',
      packagedCli.fixturePath,
      '--output',
      packagedCli.portablePackagePath,
    )
    const guiPortablePackage = JSON.parse(await readFile(packagedGuiExportPath, 'utf8'))
    const cliPortablePackage = JSON.parse(await readFile(packagedCli.portablePackagePath, 'utf8'))
    if (
      !cliExportAtSameRevision.ok ||
      cliExportAtSameRevision.data?.projectRevision !== portableBaseRevision + 1 ||
      JSON.stringify(guiPortablePackage) !== JSON.stringify(cliPortablePackage)
    ) {
      throw new Error('GUI 与打包 CLI 导出的同 revision 可移植包不一致。')
    }
    const serializedPortablePackage = JSON.stringify(guiPortablePackage)
    if (
      !guiPortablePackage.project?.components?.some(({ id }) => id === importedComponent.id) ||
      serializedPortablePackage.includes(userDataPath) ||
      serializedPortablePackage.includes('/Users/') ||
      serializedPortablePackage.includes('secretValue') ||
      serializedPortablePackage.includes('token:secret')
    ) {
      throw new Error('可移植导出包缺少组件事实，或泄漏了本机路径/敏感值。')
    }
    const portablePackageArtifactPath = path.join(
      projectPath,
      'artifacts',
      'packaged-agent-stack-package.json',
    )
    await writeFile(portablePackageArtifactPath, `${JSON.stringify(guiPortablePackage, null, 2)}\n`)
    const portableExportScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const portableExportScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-portable-export${extension}`
    await writeFile(
      portableExportScreenshotPath,
      Buffer.from(portableExportScreenshot.data, 'base64'),
    )

    const openedProjectAgent = await evaluate(
      client,
      `(() => {
        const button = document.querySelector('nav button[aria-label="Agent"]')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!openedProjectAgent) throw new Error('打包应用中找不到 Agent 主入口。')
    await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.agent-row')].find(
          (element) => element.textContent?.includes('Packaged CLI E2E')
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('h1')?.textContent === 'Packaged CLI E2E'",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === 'Harness 与组件'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('#stack-editor-heading')?.textContent?.includes('Harness 与组件')",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) =>
            element.textContent?.trim() === '添加组件' ||
            element.textContent?.trim() === '添加第一个组件'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    const addedFromGui = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.component-picker button')].find(
          (element) => element.textContent?.trim() === '添加 detected-fixture'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!addedFromGui) throw new Error('Agent 组装器未显示导入后的组件。')
    await waitForExpression(
      client,
      `document.body.innerText.includes('已添加的组件') && document.body.innerText.includes('detected-fixture') && document.body.innerText.includes('修订 ${portableBaseRevision + 3}')`,
    )
    const inspectedAfterGui = await packagedCli.invoke(
      'project',
      'inspect',
      '--project',
      packagedCli.fixturePath,
    )
    if (
      !inspectedAfterGui.ok ||
      inspectedAfterGui.data?.project?.revision !== portableBaseRevision + 2 ||
      !inspectedAfterGui.data?.project?.stack?.componentIds?.includes(importedComponent.id)
    ) {
      throw new Error(`CLI 未读到 GUI 的 Stack 修订：${JSON.stringify(inspectedAfterGui)}`)
    }

    const removedByCli = await packagedCli.invoke(
      'stack',
      'remove',
      importedComponent.id,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 2),
    )
    if (
      !removedByCli.ok ||
      removedByCli.data?.project?.revision !== portableBaseRevision + 3 ||
      removedByCli.data?.project?.stack?.componentIds?.includes(importedComponent.id)
    ) {
      throw new Error(`打包 CLI 移出 Stack 结果异常：${JSON.stringify(removedByCli)}`)
    }
    await evaluate(
      client,
      `(() => {
        const overview = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === '概览'
        )
        overview?.click()
        return Boolean(overview)
      })()`,
    )
    await delay(100)
    await evaluate(
      client,
      `(() => {
        const stack = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === 'Harness 与组件'
        )
        stack?.click()
        return Boolean(stack)
      })()`,
    )
    await waitForExpression(
      client,
      `document.body.innerText.includes('本地 Harness X') && !document.querySelector('[aria-label="从 Agent 移除 detected-fixture"]') && document.body.innerText.includes('修订 ${portableBaseRevision + 4}')`,
    )
    const projectConsistencyScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const projectConsistencyScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-project-consistency${extension}`
    await writeFile(
      projectConsistencyScreenshotPath,
      Buffer.from(projectConsistencyScreenshot.data, 'base64'),
    )

    const adapterSourcePath = path.join(
      projectPath,
      'src',
      'test',
      'fixtures',
      'm22',
      'legacy-adapter',
    )
    const importedAdapter = await packagedCli.invoke(
      'component',
      'import',
      adapterSourcePath,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 3),
    )
    const adapterComponent = importedAdapter.data?.project?.components?.find(
      ({ descriptor }) => descriptor.id === 'fixture.legacy-memory-adapter',
    )
    if (
      !importedAdapter.ok ||
      importedAdapter.data?.project?.revision !== portableBaseRevision + 4 ||
      !adapterComponent
    ) {
      throw new Error(`打包 CLI 导入 Adapter fixture 失败：${JSON.stringify(importedAdapter)}`)
    }
    await evaluate(
      client,
      `(() => {
        const overview = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === '概览'
        )
        overview?.click()
        return Boolean(overview)
      })()`,
    )
    await delay(100)
    await evaluate(
      client,
      `(() => {
        const stack = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === 'Harness 与组件'
        )
        stack?.click()
        return Boolean(stack)
      })()`,
    )
    await waitForExpression(
      client,
      `document.body.innerText.includes('修订 ${portableBaseRevision + 5}')`,
    )
    await evaluate(
      client,
      `(() => {
        const existing = [...document.querySelectorAll('.component-picker button')].find(
          (element) => element.textContent?.includes('Fixture Legacy Memory Adapter')
        )
        if (existing) return true
        const toggle = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '添加组件'
        )
        toggle?.click()
        return Boolean(toggle)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('Fixture Legacy Memory Adapter')",
    )
    const addedAdapterFromGui = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.component-picker button')].find(
          (element) => element.textContent?.trim() === '添加 Fixture Legacy Memory Adapter'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!addedAdapterFromGui) throw new Error('Agent 组装器未显示 Adapter 组件。')
    await waitForExpression(
      client,
      `document.body.innerText.includes('需 Adapter') && document.body.innerText.includes('Adapter / Fork 处置任务') && document.body.innerText.includes('修订 ${portableBaseRevision + 6}')`,
    )
    const validatedAdapter = await packagedCli.invoke(
      'project',
      'validate',
      '--project',
      packagedCli.fixturePath,
    )
    const adapterTasks = validatedAdapter.data?.validation?.remediationTasks
    if (
      !validatedAdapter.ok ||
      validatedAdapter.data?.validation?.status !== 'blocked' ||
      adapterTasks?.length !== 3 ||
      adapterTasks?.filter(({ status }) => status === 'required').length !== 1 ||
      adapterTasks?.at(-1)?.kind !== 'runtime-validation' ||
      !validatedAdapter.suggestedActions?.some(({ description }) =>
        description.includes('最小运行验证'),
      )
    ) {
      throw new Error(`打包 CLI Adapter 处置任务异常：${JSON.stringify(validatedAdapter)}`)
    }
    await evaluate(
      client,
      `(() => {
        const section = document.querySelector('[aria-label="兼容性处置任务"]')
        section?.scrollIntoView({ block: 'start' })
        const summaries = section?.querySelectorAll('summary')
        summaries?.[summaries.length - 1]?.click()
        summaries?.[summaries.length - 1]?.focus()
        return Boolean(section)
      })()`,
    )
    const projectRemediationScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const projectRemediationScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-project-adapter-remediation${extension}`
    await writeFile(
      projectRemediationScreenshotPath,
      Buffer.from(projectRemediationScreenshot.data, 'base64'),
    )

    await evaluate(
      client,
      `(() => {
        const button = document.querySelector('[aria-label="从 Agent 移除 Fixture Legacy Memory Adapter"]')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      `document.body.innerText.includes('本地 Harness X') && !document.querySelector('[aria-label="从 Agent 移除 Fixture Legacy Memory Adapter"]') && document.body.innerText.includes('修订 ${portableBaseRevision + 7}')`,
    )
    const afterAdapterRemoval = await packagedCli.invoke(
      'project',
      'inspect',
      '--project',
      packagedCli.fixturePath,
    )
    if (
      !afterAdapterRemoval.ok ||
      afterAdapterRemoval.data?.project?.revision !== portableBaseRevision + 6 ||
      afterAdapterRemoval.data?.project?.stack?.componentIds?.includes(adapterComponent.id)
    ) {
      throw new Error(`CLI 未读到 GUI 的 Adapter 移出操作：${JSON.stringify(afterAdapterRemoval)}`)
    }
    await evaluate(client, `document.querySelector('nav button[aria-label="组件"]')?.click()`)
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '组件'")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.catalog-component-link')].find(
          (element) => element.textContent?.includes('Fixture Legacy Memory Adapter')
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('可解释的兼容性评估')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.component-detail button')].find(
          (element) => element.textContent?.trim() === '归档组件'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('组件已归档，历史引用保持可读') && document.body.innerText.includes('已归档')",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.component-detail button')].find(
          (element) => element.textContent?.trim() === '永久删除'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('确认删除') && document.body.innerText.includes('取消')",
    )
    const componentDeleteConfirmationScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const componentDeleteConfirmationScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-component-delete-confirmation${extension}`
    await writeFile(
      componentDeleteConfirmationScreenshotPath,
      Buffer.from(componentDeleteConfirmationScreenshot.data, 'base64'),
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.component-detail button')].find(
          (element) => element.textContent?.trim() === '取消'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    const afterCancelledDelete = await packagedCli.invoke(
      'project',
      'inspect',
      '--project',
      packagedCli.fixturePath,
    )
    if (
      !afterCancelledDelete.ok ||
      afterCancelledDelete.data?.project?.revision !== portableBaseRevision + 7 ||
      !afterCancelledDelete.data?.project?.components?.some(({ id }) => id === adapterComponent.id)
    ) {
      throw new Error(`取消删除后项目发生变化：${JSON.stringify(afterCancelledDelete)}`)
    }
    await waitForExpression(
      client,
      "Boolean([...document.querySelectorAll('.component-detail button')].find((element) => element.textContent?.trim() === '永久删除'))",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.component-detail button')].find(
          (element) => element.textContent?.trim() === '永久删除'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('确认删除')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.component-detail button')].find(
          (element) => element.textContent?.trim() === '确认删除'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('未引用组件已删除') && !document.getElementById('component-detail-panel')",
    )
    await evaluate(
      client,
      `(() => {
        const feedback = document.querySelector('[role="status"]')
        feedback?.scrollIntoView({ block: 'start' })
        return Boolean(feedback)
      })()`,
    )
    await delay(150)
    const componentLifecycleScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const componentLifecycleScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-component-lifecycle${extension}`
    await writeFile(
      componentLifecycleScreenshotPath,
      Buffer.from(componentLifecycleScreenshot.data, 'base64'),
    )
    const afterComponentDelete = await packagedCli.invoke(
      'project',
      'inspect',
      '--project',
      packagedCli.fixturePath,
    )
    if (
      !afterComponentDelete.ok ||
      afterComponentDelete.data?.project?.revision !== portableBaseRevision + 8 ||
      afterComponentDelete.data?.project?.components?.some(
        ({ id }) => id === adapterComponent.id,
      ) ||
      !afterComponentDelete.data?.project?.components?.some(({ id }) => id === importedComponent.id)
    ) {
      throw new Error(
        `CLI 未读到 GUI 的 Component 永久删除：${JSON.stringify(afterComponentDelete)}`,
      )
    }

    await evaluate(client, `document.querySelector('nav button[aria-label="Agent"]')?.click()`)
    await waitForExpression(client, "document.querySelector('h1')?.textContent === 'Agent'")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.agent-row')].find(
          (element) => element.textContent?.includes('Packaged CLI E2E')
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('h1')?.textContent === 'Packaged CLI E2E'",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === 'Harness 与组件'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.querySelector('#stack-editor-heading')?.textContent?.includes('Harness 与组件')",
    )

    const workflowCreated = await packagedCli.invoke(
      'workflow',
      'create',
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 8),
      '--name',
      'Packaged Workflow DAG',
      '--description',
      'CLI 创建，GUI 结构化读取',
    )
    const workflowId = workflowCreated.data?.project?.workflows?.[0]?.id
    if (
      !workflowCreated.ok ||
      workflowCreated.data?.project?.revision !== portableBaseRevision + 9 ||
      !workflowId
    ) {
      throw new Error(`打包 CLI 创建 Workflow 失败：${JSON.stringify(workflowCreated)}`)
    }
    await packagedCli.invoke(
      'workflow',
      'node-add',
      workflowId,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 9),
      '--kind',
      'operation',
      '--name',
      '准备输入',
      '--ref',
      'prepare-input',
    )
    const workflowWithNodes = await packagedCli.invoke(
      'workflow',
      'node-add',
      workflowId,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 10),
      '--kind',
      'agent-version',
      '--name',
      '执行 Agent Version',
      '--ref',
      '90000000-0000-4000-8000-000000000001',
    )
    const workflowNodes = workflowWithNodes.data?.project?.workflows?.[0]?.nodes
    if (
      !workflowWithNodes.ok ||
      workflowWithNodes.data?.project?.revision !== portableBaseRevision + 11 ||
      workflowNodes?.length !== 2
    ) {
      throw new Error(`打包 CLI 添加 Workflow 节点失败：${JSON.stringify(workflowWithNodes)}`)
    }
    const workflowEdge = await packagedCli.invoke(
      'workflow',
      'edge-add',
      workflowId,
      workflowNodes[0].id,
      workflowNodes[1].id,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 11),
    )
    if (!workflowEdge.ok || workflowEdge.data?.project?.revision !== portableBaseRevision + 12) {
      throw new Error(`打包 CLI 添加 Workflow 边失败：${JSON.stringify(workflowEdge)}`)
    }
    const cliCycleFailure = await packagedCli.invokeFailure(
      'workflow',
      'edge-add',
      workflowId,
      workflowNodes[1].id,
      workflowNodes[0].id,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 12),
    )
    if (cliCycleFailure.ok !== false || cliCycleFailure.error?.code !== 'WORKFLOW_CYCLE') {
      throw new Error(`打包 CLI 未稳定拒绝 Workflow 循环：${JSON.stringify(cliCycleFailure)}`)
    }
    const frozenWorkflow = await packagedCli.invoke(
      'workflow',
      'freeze',
      workflowId,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 12),
    )
    if (
      !frozenWorkflow.ok ||
      frozenWorkflow.data?.result?.project?.revision !== portableBaseRevision + 13 ||
      frozenWorkflow.data?.version?.versionNumber !== 1
    ) {
      throw new Error(`打包 CLI 冻结 Workflow Version 失败：${JSON.stringify(frozenWorkflow)}`)
    }
    await evaluate(
      client,
      `(() => {
        const overview = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === '概览'
        )
        overview?.click()
        return Boolean(overview)
      })()`,
    )
    await delay(100)
    await evaluate(
      client,
      `(() => {
        const stack = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === 'Harness 与组件'
        )
        stack?.click()
        return Boolean(stack)
      })()`,
    )
    await waitForExpression(
      client,
      `document.body.innerText.includes('修订 ${portableBaseRevision + 14}') && document.body.innerText.includes('Packaged Workflow DAG') && document.body.innerText.includes('准备输入') && document.body.innerText.includes('Version 1')`,
    )
    const workflowReadOnlyState = await evaluate(
      client,
      `({
        hasBoundary: document.body.innerText.includes('历史事实只读'),
        hasHistory: document.body.innerText.includes('Packaged Workflow DAG'),
        hasAddNode: [...document.querySelectorAll('button')].some(
          (element) => element.textContent?.trim() === '添加节点'
        ),
        hasFreeze: [...document.querySelectorAll('button')].some(
          (element) => element.textContent?.trim() === '冻结 Workflow'
        ),
        hasDeleteEdge: Boolean(document.querySelector('[aria-label="删除 Workflow 连线"]'))
      })`,
    )
    if (
      !workflowReadOnlyState.hasBoundary ||
      !workflowReadOnlyState.hasHistory ||
      workflowReadOnlyState.hasAddNode ||
      workflowReadOnlyState.hasFreeze ||
      workflowReadOnlyState.hasDeleteEdge
    ) {
      throw new Error(`Workflow 默认只读边界异常：${JSON.stringify(workflowReadOnlyState)}`)
    }
    const enteredWorkflowMigration = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '进入旧版 Workflow 迁移工具'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!enteredWorkflowMigration) throw new Error('无法显式进入旧版 Workflow 迁移工具。')
    await waitForExpression(client, "document.body.innerText.includes('旧版迁移工具已开启')")

    const conflictingStackWrite = await packagedCli.invoke(
      'stack',
      'add',
      importedComponent.id,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 13),
    )
    if (
      !conflictingStackWrite.ok ||
      conflictingStackWrite.data?.project?.revision !== portableBaseRevision + 14
    ) {
      throw new Error(`无法构造 revision 冲突：${JSON.stringify(conflictingStackWrite)}`)
    }
    await evaluate(
      client,
      `(() => {
        const card = [...document.querySelectorAll('.workflow-card')].find(
          (element) => element.textContent?.includes('Packaged Workflow DAG')
        )
        const button = card?.querySelector('.workflow-edges button[aria-label="删除 Workflow 连线"]')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "Boolean(document.querySelector('.detail-feedback--error')) && document.body.innerText.includes('revision')",
    )
    await evaluate(
      client,
      `(() => {
        const alert = document.querySelector('.detail-feedback--error')
        alert?.scrollIntoView({ block: 'center' })
        alert?.querySelector('button')?.focus()
        return Boolean(alert)
      })()`,
    )
    await delay(150)
    const revisionConflictScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    await writeFile(
      projectConsistencyScreenshotPath,
      Buffer.from(revisionConflictScreenshot.data, 'base64'),
    )
    const restoredConflictStack = await packagedCli.invoke(
      'stack',
      'remove',
      importedComponent.id,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 14),
    )
    if (
      !restoredConflictStack.ok ||
      restoredConflictStack.data?.project?.revision !== portableBaseRevision + 15
    ) {
      throw new Error(`无法恢复 revision 冲突 fixture：${JSON.stringify(restoredConflictStack)}`)
    }
    await evaluate(
      client,
      `(() => {
        const overview = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === '概览'
        )
        overview?.click()
        return Boolean(overview)
      })()`,
    )
    await delay(100)
    await evaluate(
      client,
      `(() => {
        const stack = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === 'Harness 与组件'
        )
        stack?.click()
        return Boolean(stack)
      })()`,
    )
    await waitForExpression(
      client,
      `document.body.innerText.includes('修订 ${portableBaseRevision + 16}')`,
    )
    const reenteredWorkflowMigration = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '进入旧版 Workflow 迁移工具'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!reenteredWorkflowMigration) throw new Error('刷新后无法重新进入旧版 Workflow 迁移工具。')
    await waitForExpression(client, "document.body.innerText.includes('旧版迁移工具已开启')")
    await evaluate(
      client,
      `(() => {
        const card = [...document.querySelectorAll('.workflow-card')].find(
          (element) => element.textContent?.includes('Packaged Workflow DAG')
        )
        const button = [...(card?.querySelectorAll('button') ?? [])].find(
          (element) => element.textContent?.trim() === '添加连线'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      'Boolean(document.querySelector(\'[aria-label="为 Packaged Workflow DAG 添加连线"]\'))',
    )
    await evaluate(
      client,
      `(() => {
        const form = document.querySelector('[aria-label="为 Packaged Workflow DAG 添加连线"]')
        const selects = form?.querySelectorAll('select')
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
        setter?.call(selects?.[0], ${JSON.stringify(workflowNodes[1].id)})
        selects?.[0]?.dispatchEvent(new Event('change', { bubbles: true }))
        setter?.call(selects?.[1], ${JSON.stringify(workflowNodes[0].id)})
        selects?.[1]?.dispatchEvent(new Event('change', { bubbles: true }))
        const button = [...(form?.querySelectorAll('button') ?? [])].find(
          (element) => element.textContent?.trim() === '保存连线'
        )
        button?.focus()
        button?.click()
        return true
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('保存被拒绝：Workflow DAG 检测到直接循环')",
    )
    const workflowCycleErrorCopy = await evaluate(
      client,
      "document.querySelector('.detail-feedback--error')?.textContent?.trim()",
    )
    if (!workflowCycleErrorCopy || workflowCycleErrorCopy.includes('remote method')) {
      throw new Error(
        `Workflow 循环错误文案泄漏内部 IPC 信息：${workflowCycleErrorCopy ?? 'missing'}`,
      )
    }
    const workflowScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    const workflowScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-workflow-dag${extension}`
    await writeFile(workflowScreenshotPath, Buffer.from(workflowScreenshot.data, 'base64'))
    await evaluate(
      client,
      `(() => {
        const alert = document.querySelector('.detail-feedback--error')
        alert?.scrollIntoView({ block: 'start' })
        alert?.querySelector('button')?.focus()
        return Boolean(alert)
      })()`,
    )
    await delay(150)
    const workflowCycleScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const workflowCycleScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-workflow-cycle-error${extension}`
    await writeFile(
      workflowCycleScreenshotPath,
      Buffer.from(workflowCycleScreenshot.data, 'base64'),
    )

    await evaluate(
      client,
      `(() => {
        const card = [...document.querySelectorAll('.workflow-card')].find(
          (element) => element.textContent?.includes('Packaged Workflow DAG')
        )
        const button = card?.querySelector('.workflow-edges button[aria-label="删除 Workflow 连线"]')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      `document.body.innerText.includes('DAG 连线已删除') && document.body.innerText.includes('revision ${portableBaseRevision + 16}')`,
    )
    const afterGuiWorkflowEdit = await packagedCli.invoke(
      'workflow',
      'inspect',
      workflowId,
      '--project',
      packagedCli.fixturePath,
    )
    if (
      !afterGuiWorkflowEdit.ok ||
      afterGuiWorkflowEdit.data?.edges?.length !== 0 ||
      afterGuiWorkflowEdit.data?.versions?.length !== 1
    ) {
      throw new Error(`CLI 未读到 GUI 的 Workflow 修订：${JSON.stringify(afterGuiWorkflowEdit)}`)
    }
    const restoredWorkflowEdge = await packagedCli.invoke(
      'workflow',
      'edge-add',
      workflowId,
      workflowNodes[0].id,
      workflowNodes[1].id,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 16),
    )
    if (
      !restoredWorkflowEdge.ok ||
      restoredWorkflowEdge.data?.project?.revision !== portableBaseRevision + 17
    ) {
      throw new Error(`CLI 恢复 Workflow 边失败：${JSON.stringify(restoredWorkflowEdge)}`)
    }
    await evaluate(
      client,
      `(() => {
        const overview = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === '概览'
        )
        overview?.click()
        return Boolean(overview)
      })()`,
    )
    await delay(100)
    await evaluate(
      client,
      `(() => {
        const stack = [...document.querySelectorAll('[role="tab"]')].find(
          (element) => element.textContent?.trim() === 'Harness 与组件'
        )
        stack?.click()
        return Boolean(stack)
      })()`,
    )
    await waitForExpression(
      client,
      `document.body.innerText.includes('修订 ${portableBaseRevision + 18}')`,
    )

    const piSourcePath = path.join(projectPath, 'src', 'test', 'fixtures', 'm31', 'pi')
    const importedPi = await packagedCli.invoke(
      'component',
      'import',
      piSourcePath,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 17),
    )
    const piComponent = importedPi.data?.project?.components?.find(
      ({ descriptor }) => descriptor.id === 'pi.agent.harness',
    )
    if (
      !importedPi.ok ||
      importedPi.data?.project?.revision !== portableBaseRevision + 18 ||
      !piComponent ||
      piComponent.descriptor.compatibility.level !== 'unknown'
    ) {
      throw new Error(`Pi 静态导入失败：${JSON.stringify(importedPi)}`)
    }
    await evaluate(client, `document.querySelector('nav button[aria-label="组件"]')?.click()`)
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '组件'")
    await waitForExpression(client, "document.body.innerText.includes('pi-agent-harness')")
    await waitForExpression(client, "document.body.innerText.includes('机器证据不足')")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.catalog-component-link')].find(
          (element) => element.textContent?.includes('pi-agent-harness')
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('静态检查已完成，但不能据此判定兼容') && document.body.innerText.includes('能力替换边界')",
    )
    await evaluate(
      client,
      `(() => {
        const section = [...document.querySelectorAll('.component-detail section')].find(
          (element) => element.querySelector('h3')?.textContent?.trim() === '可解释的兼容性评估'
        )
        section?.scrollIntoView({ block: 'start' })
        return Boolean(section)
      })()`,
    )
    const compatibilityUnknownScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const compatibilityUnknownScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-compatibility-machine-evidence-missing${extension}`
    await writeFile(
      compatibilityUnknownScreenshotPath,
      Buffer.from(compatibilityUnknownScreenshot.data, 'base64'),
    )

    const untrustedDescriptor = {
      ...piComponent.descriptor,
      provides: piComponent.descriptor.provides.map((provider) => ({
        ...provider,
        replaceability: 'adapter-required',
        activation: 'owner-only',
      })),
      runtimeAdapter: './should-never-run.js',
      compatibility: {
        ...piComponent.descriptor.compatibility,
        level: 'adapter',
        validation: 'runtime-verified',
        detail: 'Pi 作为执行控制 Owner，需要内置 Harness Adapter 契约。',
        strategyRationale: '保留 Pi 外层执行控制，通过可审计 Adapter 连接。',
        strategySelectedAt: new Date().toISOString(),
      },
      evidence: [
        ...piComponent.descriptor.evidence,
        { kind: 'runtime-check', detail: 'FORGED_RUNTIME_EVIDENCE_MUST_BE_DROPPED' },
      ],
    }
    const piDescriptorPath = path.join(packagedCli.fixturePath, 'pi-descriptor.json')
    await writeFile(piDescriptorPath, `${JSON.stringify(untrustedDescriptor, null, 2)}\n`)
    const selectedPiStrategy = await packagedCli.invoke(
      'component',
      'update',
      piComponent.id,
      '--descriptor',
      piDescriptorPath,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 18),
    )
    const selectedPi = selectedPiStrategy.data?.project?.components?.find(
      ({ id }) => id === piComponent.id,
    )
    if (
      !selectedPiStrategy.ok ||
      selectedPiStrategy.data?.project?.revision !== portableBaseRevision + 19 ||
      selectedPi?.descriptor?.compatibility?.validation !== 'declared' ||
      selectedPi?.descriptor?.evidence?.some(
        ({ detail }) => detail === 'FORGED_RUNTIME_EVIDENCE_MUST_BE_DROPPED',
      )
    ) {
      throw new Error(`Descriptor 策略/证据隔离失败：${JSON.stringify(selectedPiStrategy)}`)
    }
    const piContractUntrusted = await packagedCli.invoke(
      'component',
      'contract-test',
      piComponent.id,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 19),
    )
    if (
      !piContractUntrusted.ok ||
      piContractUntrusted.data?.project?.revision !== portableBaseRevision + 20
    ) {
      throw new Error(`Pi 契约测试失败：${JSON.stringify(piContractUntrusted)}`)
    }
    await evaluate(
      client,
      `(() => {
        const details = document.querySelector('.engineering-evidence')
        if (details && !details.open) details.querySelector('summary')?.click()
        return Boolean(details)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('已通过契约测试') && document.body.innerText.includes('需要 Adapter')",
    )
    await delay(500)
    const descriptorEditorOpened = await evaluate(
      client,
      `(() => {
        const details = document.querySelector('.engineering-evidence')
        if (details) details.open = true
        const button = [...(details?.querySelectorAll('button') ?? [])].find(
          (element) => element.textContent?.trim() === '更新完整 Descriptor'
        )
        if (!button || button.disabled) return false
        button?.focus()
        button?.click()
        return true
      })()`,
    )
    if (!descriptorEditorOpened) throw new Error('完整 Descriptor 编辑入口不可用。')
    await waitForExpression(
      client,
      `(() => {
        const form = document.querySelector('.descriptor-form')
        const strategy = [...(form?.querySelectorAll('label') ?? [])].find(
          (label) => label.querySelector('span')?.textContent?.trim() === '策略'
        )?.querySelector('select')
        return strategy?.value === 'adapter' && document.body.innerText.includes('验证等级（系统只读）')
      })()`,
    )
    await evaluate(
      client,
      `(() => {
        const fieldset = [...document.querySelectorAll('.descriptor-form fieldset')].find(
          (element) => element.querySelector('legend')?.textContent?.trim() === '兼容处置策略'
        )
        fieldset?.scrollIntoView({ block: 'start' })
        return Boolean(fieldset)
      })()`,
    )
    const compatibilityStrategyScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const compatibilityStrategyScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-compatibility-adapter-strategy${extension}`
    await writeFile(
      compatibilityStrategyScreenshotPath,
      Buffer.from(compatibilityStrategyScreenshot.data, 'base64'),
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.descriptor-form button')].find(
          (element) => element.textContent?.trim() === '取消'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await evaluate(
      client,
      `(() => {
        const summary = [...document.querySelectorAll('.compatibility-actions summary')].find(
          (element) => element.textContent?.trim() === '注册精确白名单 Adapter'
        )
        summary?.focus()
        summary?.click()
        return Boolean(summary)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('当前入口不在 Studio 受信白名单') && document.body.innerText.includes('未知路径与第三方脚本不会获得运行权限')",
    )
    await evaluate(
      client,
      `(() => {
        const details = [...document.querySelectorAll('.compatibility-actions details')].find(
          (element) => element.textContent?.includes('注册精确白名单 Adapter')
        )
        details?.scrollIntoView({ block: 'start' })
        return Boolean(details)
      })()`,
    )
    const compatibilityFailureScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const compatibilityFailureScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-compatibility-validation-failed${extension}`
    await writeFile(
      compatibilityFailureScreenshotPath,
      Buffer.from(compatibilityFailureScreenshot.data, 'base64'),
    )

    const trustedDescriptor = {
      ...selectedPi.descriptor,
      runtimeAdapter: 'studio://runtime/harness-x',
    }
    await writeFile(piDescriptorPath, `${JSON.stringify(trustedDescriptor, null, 2)}\n`)
    const trustedPiStrategy = await packagedCli.invoke(
      'component',
      'update',
      piComponent.id,
      '--descriptor',
      piDescriptorPath,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 20),
    )
    const trustedPiContract = await packagedCli.invoke(
      'component',
      'contract-test',
      piComponent.id,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 21),
    )
    if (
      !trustedPiStrategy.ok ||
      !trustedPiContract.ok ||
      trustedPiContract.data?.project?.revision !== portableBaseRevision + 22
    ) {
      throw new Error(
        `Pi 白名单 Adapter 处置失败：${JSON.stringify({ trustedPiStrategy, trustedPiContract })}`,
      )
    }
    await waitForExpression(
      client,
      "document.body.innerText.includes('studio://runtime/harness-x') && document.body.innerText.includes('进入受信最小运行验证')",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.compatibility-actions button')].find(
          (element) => element.textContent?.trim() === '进入受信最小运行验证'
        )
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "Boolean([...document.querySelectorAll('.component-detail button')].find((element) => element.textContent?.trim() === '取消运行验证'))",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.component-detail button')].find(
          (element) => element.textContent?.trim() === '取消运行验证'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('正在取消运行验证，本次不会写入证据')",
    )
    await evaluate(
      client,
      `(() => {
        const status = document.querySelector('.detail-feedback[role="status"]')
        status?.scrollIntoView({ block: 'start' })
        return Boolean(status)
      })()`,
    )
    const compatibilityCancelledScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const compatibilityCancelledScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-compatibility-validation-cancelled${extension}`
    await writeFile(
      compatibilityCancelledScreenshotPath,
      Buffer.from(compatibilityCancelledScreenshot.data, 'base64'),
    )
    await waitForExpression(
      client,
      "Boolean([...document.querySelectorAll('.compatibility-actions button')].find((element) => element.textContent?.trim() === '进入受信最小运行验证' && !element.disabled))",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.compatibility-actions button')].find(
          (element) => element.textContent?.trim() === '进入受信最小运行验证'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('受信最小运行验证已通过') && document.body.innerText.includes('运行验证通过')",
    )
    await evaluate(
      client,
      `(() => {
        const status = document.querySelector('.detail-feedback[role="status"]')
        status?.scrollIntoView({ block: 'start' })
        return Boolean(status)
      })()`,
    )
    const compatibilitySucceededScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const compatibilitySucceededScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-compatibility-validation-succeeded${extension}`
    await writeFile(
      compatibilitySucceededScreenshotPath,
      Buffer.from(compatibilitySucceededScreenshot.data, 'base64'),
    )

    const archivedPi = await packagedCli.invoke(
      'component',
      'archive',
      piComponent.id,
      '--project',
      packagedCli.fixturePath,
      '--revision',
      String(portableBaseRevision + 23),
    )
    if (!archivedPi.ok || archivedPi.data?.project?.revision !== portableBaseRevision + 24) {
      throw new Error(`Pi 归档失败：${JSON.stringify(archivedPi)}`)
    }
    await waitForExpression(
      client,
      "Boolean([...document.querySelectorAll('.component-detail button')].find((element) => element.textContent?.trim() === '恢复组件'))",
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.component-detail button')].find(
          (element) => element.textContent?.trim() === '恢复组件'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(
      client,
      "document.body.innerText.includes('组件已恢复，现在可在 Agent Stack 中选择') && Boolean([...document.querySelectorAll('.component-detail button')].find((element) => element.textContent?.trim() === '归档组件'))",
    )
    await evaluate(
      client,
      `(() => {
        const status = document.querySelector('.detail-feedback[role="status"]')
        status?.scrollIntoView({ block: 'start' })
        return Boolean(status)
      })()`,
    )
    const componentRestoreScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    const componentRestoreScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-component-restored${extension}`
    await writeFile(
      componentRestoreScreenshotPath,
      Buffer.from(componentRestoreScreenshot.data, 'base64'),
    )
    const restoredPi = await packagedCli.invoke(
      'project',
      'inspect',
      '--project',
      packagedCli.fixturePath,
    )
    if (
      !restoredPi.ok ||
      restoredPi.data?.project?.revision !== portableBaseRevision + 25 ||
      restoredPi.data?.project?.components?.find(({ id }) => id === piComponent.id)?.archivedAt !==
        null
    ) {
      throw new Error(`Pi 恢复未由包内 CLI 读到：${JSON.stringify(restoredPi)}`)
    }

    await evaluate(
      client,
      `(() => {
        document.querySelector('.workspace-identity')?.click()
        return true
      })()`,
    )
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '项目设置'")
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '导出可移植包'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.body.innerText.includes('已导出可移植包')")
    const finalGuiPackage = JSON.parse(await readFile(packagedGuiExportPath, 'utf8'))
    const finalCliExport = await packagedCli.invoke(
      'project',
      'export',
      '--project',
      packagedCli.fixturePath,
      '--output',
      packagedCli.portablePackagePath,
    )
    const finalCliPackage = JSON.parse(await readFile(packagedCli.portablePackagePath, 'utf8'))
    if (
      !finalCliExport.ok ||
      finalCliExport.data?.projectRevision !== portableBaseRevision + 25 ||
      finalCliExport.data?.workflowCount !== 1 ||
      JSON.stringify(finalGuiPackage) !== JSON.stringify(finalCliPackage) ||
      finalGuiPackage.project?.workflows?.[0]?.versions?.length !== 1
    ) {
      throw new Error('Workflow 导出后 GUI 与打包 CLI 的 v2 可移植包不一致。')
    }
    await writeFile(portablePackageArtifactPath, `${JSON.stringify(finalGuiPackage, null, 2)}\n`)

    const restoreProofPath = path.join(userDataPath, 'artifacts', 'packaged-restore-proof.txt')
    const backupParentPath = path.join(userDataPath, 'e2e-backups')
    await mkdir(path.dirname(restoreProofPath), { recursive: true })
    await writeFile(restoreProofPath, 'from-verified-backup\n', 'utf8')
    await evaluate(
      client,
      `(() => {
        const button = document.querySelector('nav button[aria-label="设置"]')
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '设置'")
    const createdPackagedBackup = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '选择位置并创建备份'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!createdPackagedBackup) throw new Error('打包应用中找不到创建备份操作。')
    await waitForExpression(client, "document.body.innerText.includes('备份已创建：')")
    const backupEntries = await readdir(backupParentPath, { withFileTypes: true })
    const backupDirectories = backupEntries.filter(
      (entry) => entry.isDirectory() && entry.name.startsWith('Agent Stack Studio Backup '),
    )
    if (backupDirectories.length !== 1) {
      throw new Error(`打包备份数量异常：${backupDirectories.length}`)
    }
    await writeFile(restoreProofPath, 'mutated-after-backup\n', 'utf8')
    const selectedPackagedRestore = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '选择备份并检查'
        )
        button?.focus()
        button?.click()
        return Boolean(button)
      })()`,
    )
    if (!selectedPackagedRestore) throw new Error('打包应用中找不到备份检查操作。')
    await waitForExpression(client, "document.body.innerText.includes('备份检查通过')")
    const requestedPackagedRestore = await evaluate(
      client,
      `(() => {
        const checkbox = document.querySelector('.restore-confirmation input[type="checkbox"]')
        checkbox?.click()
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === '恢复备份并重启'
        )
        button?.focus()
        button?.click()
        return Boolean(checkbox && button && !button.disabled)
      })()`,
    )
    if (!requestedPackagedRestore) throw new Error('备份恢复确认操作未启用。')
    const exitDeadline = Date.now() + 10_000
    while (processState.exitCode === null && Date.now() < exitDeadline) await delay(100)
    if (processState.exitCode === null) throw new Error('打包应用准备恢复后未按预期退出。')
    client.close()
    client = undefined
    await delay(250)
    launchedApplication = launchApplication()
    child = launchedApplication.child
    processState = launchedApplication.processState
    const restartedTarget = await waitForTarget(port, processState)
    client = createCdpClient(restartedTarget.webSocketDebuggerUrl)
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await waitForExpression(client, "document.querySelector('h1')?.textContent === '设置'")
    await waitForExpression(
      client,
      "document.body.innerText.includes('最近恢复') && !document.body.innerText.includes('尚未执行恢复')",
    )
    const restoredProof = await readFile(restoreProofPath, 'utf8')
    const recoveryEntries = await readdir(path.join(userDataPath, 'recovery'), {
      withFileTypes: true,
    })
    const rollbackBackup = recoveryEntries.find(
      (entry) => entry.isDirectory() && entry.name.startsWith('Agent Stack Studio Backup '),
    )
    if (!rollbackBackup || restoredProof !== 'from-verified-backup\n') {
      throw new Error(
        `打包恢复未还原备份内容或缺少自动回滚备份：${JSON.stringify({ restoredProof, rollbackBackup: rollbackBackup?.name })}`,
      )
    }
    const rollbackProof = await readFile(
      path.join(
        userDataPath,
        'recovery',
        rollbackBackup.name,
        'artifacts',
        'packaged-restore-proof.txt',
      ),
      'utf8',
    )
    if (rollbackProof !== 'mutated-after-backup\n') {
      throw new Error(`自动回滚备份没有保留恢复前内容：${JSON.stringify(rollbackProof)}`)
    }
    const backupRestoreScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    const backupRestoreScreenshotPath = `${screenshotPath.slice(0, -extension.length)}-backup-restore${extension}`
    await writeFile(
      backupRestoreScreenshotPath,
      Buffer.from(backupRestoreScreenshot.data, 'base64'),
    )
    const packagedCliEvidence = {
      cliPath: packagedCli.cliPath,
      version: packagedCli.version,
      fixturePath: packagedCli.fixturePath,
      projectId: packagedCli.projectId,
      projectFormatVersion: packagedCli.projectFormatVersion,
      packageHash: finalGuiPackage.contentHash,
      packageFormatVersion: finalGuiPackage.packageFormatVersion,
      finalRevision: restoredPi.data.project.revision,
      componentId: importedComponent.id,
      workflowId,
      productCommandMigration: 'verified',
      recipeCount: packagedCli.recipeCount,
      doctorStatus: packagedCli.doctorStatus,
    }
    return {
      applicationPath,
      screenshotPath,
      preferencesScreenshotPath,
      doctorScreenshotPath,
      doctorState,
      dataLocationsScreenshotPath,
      sourceDiscoveryIdleScreenshotPath: sourceDiscoveryEvidence.idleScreenshotPath,
      sourceDiscoveryErrorScreenshotPath: sourceDiscoveryEvidence.errorScreenshotPath,
      m36RecipeScreenshotPath: sourceDiscoveryEvidence.recipeScreenshotPath,
      commandCenterScreenshotPath: commandCenterEvidence.commandCenterScreenshotPath,
      keychainScreenshotPath,
      runtimeScreenshotPath,
      runHistoryScreenshotPath,
      experimentMatrixScreenshotPath: experimentEvidence.experimentMatrixScreenshotPath,
      experimentComparisonScreenshotPath: experimentEvidence.experimentComparisonScreenshotPath,
      agentStatusScreenshotPath,
      componentDetailScreenshotPath,
      capabilityScreenshotPath,
      modelAuthBlockedScreenshotPath,
      remediationScreenshotPath,
      lifecycleScreenshotPath,
      projectConsistencyScreenshotPath,
      projectRemediationScreenshotPath,
      componentDeleteConfirmationScreenshotPath,
      componentLifecycleScreenshotPath,
      portableExportScreenshotPath,
      portablePackageArtifactPath,
      workflowScreenshotPath,
      workflowCycleScreenshotPath,
      compatibilityUnknownScreenshotPath,
      compatibilityStrategyScreenshotPath,
      compatibilityFailureScreenshotPath,
      compatibilityCancelledScreenshotPath,
      compatibilitySucceededScreenshotPath,
      componentRestoreScreenshotPath,
      backupRestoreScreenshotPath,
      guidedSetupScreenshotPath: guidedSetupEvidence.guidedSetupScreenshotPath,
      guidedCompletionScreenshotPath: guidedCompletionEvidence.screenshotPath,
      rendererBoundary,
      reachableNavigation,
      accessibilityTree,
      persistedPreferences,
      settingsCopy,
      capabilityCopy,
      remediationCopy,
      demoFeedbackLayout,
      sourceDiscoveryFailureCopy: sourceDiscoveryEvidence.failureCopy,
      m36RecipeState: sourceDiscoveryEvidence.recipeState,
      commandCenterState: commandCenterEvidence.state,
      lifecycleErrorCopy,
      runHistoryFailureCopy,
      experimentMatrixState: experimentEvidence.state,
      packagedCli: packagedCliEvidence,
      guidedSetup: guidedSetupEvidence,
      guidedCompletion: guidedCompletionEvidence,
    }
  } finally {
    client?.close()
    if (processState.exitCode === null) child.kill('SIGTERM')
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2_000)])
    if (processState.exitCode === null) child.kill('SIGKILL')
    await rm(userDataPath, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPackagedAppE2e()
    .then((result) => {
      console.log(`PACKAGED_E2E_OK ${result.applicationPath}`)
      console.log(`SCREENSHOT ${result.screenshotPath}`)
      console.log(`PREFERENCES_SCREENSHOT ${result.preferencesScreenshotPath}`)
      console.log(`DOCTOR_SCREENSHOT ${result.doctorScreenshotPath}`)
      console.log(`DATA_LOCATIONS_SCREENSHOT ${result.dataLocationsScreenshotPath}`)
      console.log(`SOURCE_DISCOVERY_IDLE_SCREENSHOT ${result.sourceDiscoveryIdleScreenshotPath}`)
      console.log(`SOURCE_DISCOVERY_ERROR_SCREENSHOT ${result.sourceDiscoveryErrorScreenshotPath}`)
      console.log(`M36_RECIPE_SCREENSHOT ${result.m36RecipeScreenshotPath}`)
      console.log(`COMMAND_CENTER_SCREENSHOT ${result.commandCenterScreenshotPath}`)
      console.log(`KEYCHAIN_SCREENSHOT ${result.keychainScreenshotPath}`)
      console.log(`RUNTIME_SCREENSHOT ${result.runtimeScreenshotPath}`)
      console.log(`RUN_HISTORY_SCREENSHOT ${result.runHistoryScreenshotPath}`)
      console.log(`EXPERIMENT_MATRIX_SCREENSHOT ${result.experimentMatrixScreenshotPath}`)
      console.log(`EXPERIMENT_COMPARISON_SCREENSHOT ${result.experimentComparisonScreenshotPath}`)
      console.log(`AGENT_STATUS_SCREENSHOT ${result.agentStatusScreenshotPath}`)
      console.log(`COMPONENT_DETAIL_SCREENSHOT ${result.componentDetailScreenshotPath}`)
      console.log(`CAPABILITY_SCREENSHOT ${result.capabilityScreenshotPath}`)
      console.log(`MODEL_AUTH_BLOCKED_SCREENSHOT ${result.modelAuthBlockedScreenshotPath}`)
      console.log(`ADAPTER_REMEDIATION_SCREENSHOT ${result.remediationScreenshotPath}`)
      console.log(`AGENT_LIFECYCLE_SCREENSHOT ${result.lifecycleScreenshotPath}`)
      console.log(`PROJECT_CONSISTENCY_SCREENSHOT ${result.projectConsistencyScreenshotPath}`)
      console.log(`PROJECT_REMEDIATION_SCREENSHOT ${result.projectRemediationScreenshotPath}`)
      console.log(
        `COMPONENT_DELETE_CONFIRMATION_SCREENSHOT ${result.componentDeleteConfirmationScreenshotPath}`,
      )
      console.log(`COMPONENT_LIFECYCLE_SCREENSHOT ${result.componentLifecycleScreenshotPath}`)
      console.log(`PORTABLE_EXPORT_SCREENSHOT ${result.portableExportScreenshotPath}`)
      console.log(`PORTABLE_PACKAGE ${result.portablePackageArtifactPath}`)
      console.log(`WORKFLOW_DAG_SCREENSHOT ${result.workflowScreenshotPath}`)
      console.log(`WORKFLOW_CYCLE_SCREENSHOT ${result.workflowCycleScreenshotPath}`)
      console.log(`COMPATIBILITY_UNKNOWN_SCREENSHOT ${result.compatibilityUnknownScreenshotPath}`)
      console.log(`COMPATIBILITY_STRATEGY_SCREENSHOT ${result.compatibilityStrategyScreenshotPath}`)
      console.log(`COMPATIBILITY_FAILURE_SCREENSHOT ${result.compatibilityFailureScreenshotPath}`)
      console.log(
        `COMPATIBILITY_CANCELLED_SCREENSHOT ${result.compatibilityCancelledScreenshotPath}`,
      )
      console.log(
        `COMPATIBILITY_SUCCEEDED_SCREENSHOT ${result.compatibilitySucceededScreenshotPath}`,
      )
      console.log(`COMPONENT_RESTORE_SCREENSHOT ${result.componentRestoreScreenshotPath}`)
      console.log(`BACKUP_RESTORE_SCREENSHOT ${result.backupRestoreScreenshotPath}`)
      console.log(`GUIDED_SETUP_SCREENSHOT ${result.guidedSetupScreenshotPath}`)
      console.log(`GUIDED_COMPLETION_SCREENSHOT ${result.guidedCompletionScreenshotPath}`)
      console.log(`PACKAGED_CLI ${result.packagedCli.cliPath}`)
      console.log(`PACKAGED_CLI_VERSION ${result.packagedCli.version}`)
      console.log(`PACKAGED_CLI_PROJECT_FORMAT ${result.packagedCli.projectFormatVersion}`)
      console.log(`PACKAGED_CLI_RECIPE_COUNT ${result.packagedCli.recipeCount}`)
      console.log(`PACKAGED_CLI_DOCTOR ${result.packagedCli.doctorStatus.toUpperCase()}`)
      console.log(`PACKAGED_PROJECT_FINAL_REVISION ${result.packagedCli.finalRevision}`)
      console.log(`PACKAGED_PROJECT_PACKAGE_FORMAT ${result.packagedCli.packageFormatVersion}`)
      console.log(
        `PRODUCT_CLI_MIGRATION ${result.packagedCli.productCommandMigration.toUpperCase()}`,
      )
      console.log('LEGACY_MODEL_READONLY_MIGRATION VERIFIED')
      console.log('PACKAGED_BACKUP_RESTORE VERIFIED')
      console.log('RENDERER_NODE DISABLED')
      console.log(`NAVIGATION_REACHABILITY VERIFIED (${result.reachableNavigation.length})`)
      console.log(
        `PACKAGED_ACCESSIBILITY_TREE VERIFIED (${result.accessibilityTree.buttonCount} buttons, ${result.accessibilityTree.unnamedButtons} unnamed)`,
      )
      console.log('CHINESE_SETTINGS VERIFIED')
      console.log('DATA_LOCATION_BOUNDARIES VERIFIED')
      console.log(
        `STUDIO_DOCTOR VERIFIED (${result.doctorState.checks} checks, cliPassed=${result.doctorState.cliPassed})`,
      )
      console.log('SOURCE_DISCOVERY_STATE_COVERAGE VERIFIED')
      console.log(
        `M36_RECIPE_CATALOG VERIFIED (${result.m36RecipeState.optionCount} recipes, degraded=${result.m36RecipeState.hasDegradation}, safe=${result.m36RecipeState.hasSafetyBoundary})`,
      )
      console.log('WORKSPACE_COMMAND_CENTER VERIFIED')
      console.log('PERSISTED_UI_PREFERENCES VERIFIED')
      console.log('TRUSTED_HYBRID_RUNTIME VERIFIED')
      console.log('RUN_HISTORY_OBSERVABILITY VERIFIED')
      console.log('EXPERIMENT_MATRIX_OBSERVABILITY VERIFIED')
      console.log('AGENT_STATUS_PROJECTION VERIFIED')
      console.log('COMPONENT_CATALOG_DETAIL VERIFIED')
      console.log('COMPONENT_REMEDIATION_TASKS VERIFIED')
      console.log('PROJECT_COMPONENT_LIFECYCLE VERIFIED')
      console.log('AGENT_LIFECYCLE VERIFIED')
      console.log('PACKAGED_CLI_EXECUTION VERIFIED')
      console.log('PACKAGED_GUI_CLI_BIDIRECTIONAL VERIFIED')
      console.log('SECRET_FREE_PORTABLE_PACKAGE VERIFIED')
      console.log('VERSIONED_WORKFLOW_DAG VERIFIED')
      console.log('COMPATIBILITY_REMEDIATION_WORKFLOW VERIFIED')
      console.log('COMPONENT_ARCHIVE_RESTORE VERIFIED')
      console.log('GUIDED_AGENT_SETUP_CANCEL_SAVE_RESUME VERIFIED')
      console.log('GUIDED_AGENT_SETUP_CONTROLLED_COMPLETION VERIFIED')
      console.log('GUIDED_CONTROLLED_HARNESS DOES_NOT_CLAIM_PROVIDER_AUTH')
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
