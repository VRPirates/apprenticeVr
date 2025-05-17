import {
  DeviceInfo,
  GameInfo,
  DownloadItem,
  DownloadProgress,
  DependencyStatus,
  PackageInfo,
  UploadItem,
  UploadPreparationProgress,
  UpdateInfo,
  UpdateProgressInfo
} from './index'

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
  // Dependency related channels
  'dependency:get-status': DefineChannel<[], DependencyStatus>

  // ADB related channels
  'adb:list-devices': DefineChannel<[], DeviceInfo[]>
  'adb:connect-device': DefineChannel<[serial: string], boolean>
  'adb:get-installed-packages': DefineChannel<[serial: string], PackageInfo[]>
  'adb:uninstallPackage': DefineChannel<[serial: string, packageName: string], boolean>
  'adb:get-application-label': DefineChannel<[serial: string, packageName: string], string | null>

  // Game related channels
  'games:get-games': DefineChannel<[], GameInfo[]>
  'games:get-blacklist-games': DefineChannel<[], string[]>
  'games:get-last-sync-time': DefineChannel<[], Date | null>
  'games:force-sync-games': DefineChannel<[], GameInfo[]>
  'games:get-note': DefineChannel<[releaseName: string], string>
  'games:get-trailer-video-id': DefineChannel<[gameName: string], string | null>

  // Download related channels
  'download:get-queue': DefineChannel<[], DownloadItem[]>
  'download:add': DefineChannel<[game: GameInfo], boolean>
  'download:delete-files': DefineChannel<[releaseName: string], boolean>
  'download:install-from-completed': DefineChannel<[releaseName: string, deviceId: string], void>

  // Upload related channels
  'upload:prepare': DefineChannel<
    [packageName: string, gameName: string, versionCode: number, deviceId: string],
    string | null
  >
  'upload:get-queue': DefineChannel<[], UploadItem[]>
  'upload:add-to-queue': DefineChannel<
    [packageName: string, gameName: string, versionCode: number, deviceId: string],
    boolean
  >

  // Update related channels
  'update:check-for-updates': DefineChannel<[], void>

  // Settings related channels
  'settings:get-download-path': DefineChannel<[], string>
  'settings:set-download-path': DefineChannel<[path: string], void>
  'settings:get-download-speed-limit': DefineChannel<[], number>
  'settings:set-download-speed-limit': DefineChannel<[limit: number], void>
  'settings:get-upload-speed-limit': DefineChannel<[], number>
  'settings:set-upload-speed-limit': DefineChannel<[limit: number], void>

  // Dialog related channels
  'dialog:show-directory-picker': DefineChannel<[], string | null>
}

// Types for send (no response) channels
export interface IPCSendChannels {
  'adb:start-tracking-devices': void
  'adb:stop-tracking-devices': void
  'download:remove': string
  'download:cancel': string
  'download:retry': string
  'download:set-download-path': string
  'upload:remove': string
  'upload:cancel': string
  'update:download': string
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
  'download:queue-updated': [queue: DownloadItem[]]
  'upload:progress': [progress: UploadPreparationProgress]
  'upload:queue-updated': [queue: UploadItem[]]
  'settings:download-speed-limit-changed': [limit: number]
  'settings:upload-speed-limit-changed': [limit: number]
  'update:checking-for-update': []
  'update:update-available': [updateInfo: UpdateInfo]
  'update:error': [error: Error]
  'update:download-progress': [progressInfo: UpdateProgressInfo]
  'update:update-downloaded': [updateInfo: UpdateInfo]
}
