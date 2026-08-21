import { describe, expect, it } from 'vitest'
import {
  validateCompiledMainSecurity,
  validateContentSecurityPolicy,
} from './verify-security-boundaries.mjs'

describe('packaged Electron security policy', () => {
  it('accepts the required offline Renderer policy', () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'" />`
    expect(() => validateContentSecurityPolicy(html)).not.toThrow()
  })

  it('rejects a permissive policy', () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'" />`
    expect(() => validateContentSecurityPolicy(html)).toThrow(/CSP/)
  })

  it('requires compiled Main security markers', () => {
    const source = [
      'enableSandbox',
      'setPermissionCheckHandler',
      'setPermissionRequestHandler',
      'setDevicePermissionHandler',
      'will-download',
      'will-attach-webview',
      'setWindowOpenHandler',
      'navigateOnDragDrop',
      'allowRunningInsecureContent',
    ].join(' ')
    expect(() => validateCompiledMainSecurity(source)).not.toThrow()
    expect(() => validateCompiledMainSecurity(source.replace('will-download', ''))).toThrow(
      /will-download/,
    )
  })
})
