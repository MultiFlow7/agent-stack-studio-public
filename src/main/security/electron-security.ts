import type { Event, Session, WebContents } from 'electron'

type HardenedSession = Pick<
  Session,
  | 'setPermissionCheckHandler'
  | 'setPermissionRequestHandler'
  | 'setDevicePermissionHandler'
  | 'on'
  | 'off'
>

type HardenedWebContents = Pick<WebContents, 'setWindowOpenHandler' | 'on' | 'off'>

export function hardenSession(session: HardenedSession): () => void {
  const denyDownload = (event: Event): void => event.preventDefault()

  session.setPermissionCheckHandler(() => false)
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.setDevicePermissionHandler(() => false)
  session.on('will-download', denyDownload)

  return () => {
    session.setPermissionCheckHandler(null)
    session.setPermissionRequestHandler(null)
    session.setDevicePermissionHandler(null)
    session.off('will-download', denyDownload)
  }
}

export function hardenWebContents(webContents: HardenedWebContents): () => void {
  const denyNavigation = (event: Event): void => event.preventDefault()
  const denyWebview = (event: Event): void => event.preventDefault()

  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-navigate', denyNavigation)
  webContents.on('will-attach-webview', denyWebview)

  return () => {
    webContents.off('will-navigate', denyNavigation)
    webContents.off('will-attach-webview', denyWebview)
  }
}
