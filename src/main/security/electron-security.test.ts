import type { Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { hardenSession, hardenWebContents } from './electron-security'

describe('Electron default-deny security boundaries', () => {
  it('denies permissions, devices and downloads for the application session', () => {
    const listeners = new Map<string, (...args: never[]) => void>()
    const setPermissionCheckHandler = vi.fn<Session['setPermissionCheckHandler']>()
    const setPermissionRequestHandler = vi.fn<Session['setPermissionRequestHandler']>()
    const setDevicePermissionHandler = vi.fn<Session['setDevicePermissionHandler']>()
    const on = vi.fn((event: string, listener: (...args: never[]) => void) =>
      listeners.set(event, listener),
    )
    const off = vi.fn()
    const session = {
      setPermissionCheckHandler,
      setPermissionRequestHandler,
      setDevicePermissionHandler,
      on,
      off,
    } as unknown as Session

    const cleanup = hardenSession(session)
    const permissionCheck = setPermissionCheckHandler.mock.calls[0]?.[0]
    const permissionRequest = setPermissionRequestHandler.mock.calls[0]?.[0]
    const devicePermission = setDevicePermissionHandler.mock.calls[0]?.[0]
    const permissionCallback = vi.fn()
    const preventDefault = vi.fn()

    expect(permissionCheck?.(null, 'geolocation', 'file:///', {} as never)).toBe(false)
    permissionRequest?.({} as never, 'media', permissionCallback, {} as never)
    expect(permissionCallback).toHaveBeenCalledWith(false)
    expect(devicePermission?.({} as never)).toBe(false)
    listeners.get('will-download')?.({ preventDefault } as never)
    expect(preventDefault).toHaveBeenCalledOnce()

    cleanup()
    expect(setPermissionCheckHandler).toHaveBeenLastCalledWith(null)
    expect(setPermissionRequestHandler).toHaveBeenLastCalledWith(null)
    expect(setDevicePermissionHandler).toHaveBeenLastCalledWith(null)
    expect(off).toHaveBeenCalledWith('will-download', listeners.get('will-download'))
  })

  it('denies new windows, navigation and webview attachment', () => {
    const listeners = new Map<string, (...args: never[]) => void>()
    const setWindowOpenHandler = vi.fn<WebContents['setWindowOpenHandler']>()
    const on = vi.fn((event: string, listener: (...args: never[]) => void) =>
      listeners.set(event, listener),
    )
    const off = vi.fn()
    const webContents = {
      setWindowOpenHandler,
      on,
      off,
    } as unknown as WebContents

    const cleanup = hardenWebContents(webContents)
    const openHandler = setWindowOpenHandler.mock.calls[0]?.[0]
    const preventNavigation = vi.fn()
    const preventWebview = vi.fn()

    expect(openHandler?.({} as never)).toEqual({ action: 'deny' })
    listeners.get('will-navigate')?.({ preventDefault: preventNavigation } as never)
    listeners.get('will-attach-webview')?.({ preventDefault: preventWebview } as never)
    expect(preventNavigation).toHaveBeenCalledOnce()
    expect(preventWebview).toHaveBeenCalledOnce()

    cleanup()
    expect(off).toHaveBeenCalledTimes(2)
  })
})
