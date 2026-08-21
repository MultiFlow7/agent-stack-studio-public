import { extractFile } from '@electron/asar'
import path from 'node:path'

const requiredCspDirectives = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
]

const requiredMainMarkers = [
  'enableSandbox',
  'setPermissionCheckHandler',
  'setPermissionRequestHandler',
  'setDevicePermissionHandler',
  'will-download',
  'will-attach-webview',
  'setWindowOpenHandler',
  'navigateOnDragDrop',
  'allowRunningInsecureContent',
]

export function validateContentSecurityPolicy(html) {
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]
  if (!policy) throw new Error('Renderer 缺少 Content-Security-Policy。')
  for (const directive of requiredCspDirectives) {
    if (!policy.includes(directive)) throw new Error(`Renderer CSP 缺少：${directive}`)
  }
  if (/unsafe-(?:inline|eval)|https?:/.test(policy))
    throw new Error('Renderer CSP 包含不安全来源。')
}

export function validateCompiledMainSecurity(source) {
  for (const marker of requiredMainMarkers) {
    if (!source.includes(marker)) throw new Error(`Main 安全构建缺少：${marker}`)
  }
}

export function verifyPackagedSecurity(applicationPath) {
  const archivePath = path.join(applicationPath, 'Contents', 'Resources', 'app.asar')
  const rendererHtml = extractFile(archivePath, 'dist/renderer/index.html').toString('utf8')
  const compiledMain = extractFile(archivePath, 'dist/main/index.mjs').toString('utf8')
  validateContentSecurityPolicy(rendererHtml)
  validateCompiledMainSecurity(compiledMain)
}
