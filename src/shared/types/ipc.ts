import { DeviceInfo, GameInfo, DownloadItem, DownloadProgress, DependencyStatus } from './index'

// Define types for all IPC channels between renderer and main

/**
 * Helper type for defining a new IPC channel
 * @example
 * // Define a new channel in IPCChannels:
 * 'my-new-channel': DefineChannel<[param1: string, param2: number], boolean>
 */
export type DefineChannel<TParams extends unknown[] = [], TReturn = void> = {
  params: TParams
  returns: TReturn
}

// Interface mapping channel names to their parameter and return types
export interface IPCChannels {
  // ADB related channels
  'adb:list-devices': DefineChannel<[], DeviceInfo[]>
  'adb:connect-device': DefineChannel<[serial: string], boolean>
  'adb:get-installed-packages': DefineChannel<[serial: string], Array<{ packageName: string }>>
  'adb:getPackageVersionCode': DefineChannel<[serial: string, packageName: string], number | null>
  'adb:uninstallPackage': DefineChannel<[serial: string, packageName: string], boolean>

  // Game related channels
  'games:get-games': DefineChannel<[], GameInfo[]>
  'games:get-last-sync-time': DefineChannel<[], Date | null>
  'games:force-sync-games': DefineChannel<[], GameInfo[]>
  'games:get-note': DefineChannel<[releaseName: string], string>

  // Download related channels
  'download:get-queue': DefineChannel<[], DownloadItem[]>
  'download:add': DefineChannel<[game: GameInfo], boolean>
  'download:delete-files': DefineChannel<[releaseName: string], boolean>
  'download:install-from-completed': DefineChannel<[releaseName: string, deviceId: string], void>
}

// Types for send (no response) channels
export interface IPCSendChannels {
  'initialize-dependencies': void
  'adb:start-tracking-devices': void
  'adb:stop-tracking-devices': void
  'download:remove': string
  'download:cancel': string
  'download:retry': string
}

// Types for events emitted from main to renderer
export interface IPCEvents {
  'dependency-progress': [status: DependencyStatus, progress: { name: string; percentage: number }]
  'dependency-setup-complete': [status: DependencyStatus]
  'dependency-setup-error': [errorInfo: { message: string; status: DependencyStatus }]
  'adb:device-added': [device: DeviceInfo]
  'adb:device-removed': [device: DeviceInfo]
  'adb:device-changed': [device: DeviceInfo]
  'adb:device-tracker-error': [error: string]
  'adb:installation-completed': [deviceId: string]
  'games:download-progress': [progress: DownloadProgress]
  'games:extract-progress': [progress: { type: string; progress: number }]
  'download:queue-updated': [queue: DownloadItem[]]
}
