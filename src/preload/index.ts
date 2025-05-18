import { contextBridge, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  GameInfo,
  DeviceInfo,
  DependencyStatus,
  DownloadItem,
  DownloadProgress,
  AdbAPIRenderer,
  GameAPIRenderer,
  DownloadAPIRenderer,
  SettingsAPIRenderer,
  PackageInfo,
  UploadPreparationProgress,
  UploadAPIRenderer,
  UploadItem,
  UpdateInfo,
  UpdateAPIRenderer,
  DependencyAPIRenderer
} from '@shared/types'
import { typedIpcRenderer } from '@shared/ipc-utils'

const api = {
  dependency: {
    getStatus: (): Promise<DependencyStatus> => typedIpcRenderer.invoke('dependency:get-status')
  } satisfies DependencyAPIRenderer,
  adb: {
    listDevices: (): Promise<DeviceInfo[]> => typedIpcRenderer.invoke('adb:list-devices'),
    connectDevice: (serial: string): Promise<boolean> =>
      typedIpcRenderer.invoke('adb:connect-device', serial),
    getInstalledPackages: (serial: string): Promise<PackageInfo[]> =>
      typedIpcRenderer.invoke('adb:get-installed-packages', serial),
    uninstallPackage: (serial: string, packageName: string): Promise<boolean> =>
      typedIpcRenderer.invoke('adb:uninstallPackage', serial, packageName),
    startTrackingDevices: (): void => typedIpcRenderer.send('adb:start-tracking-devices'),
    stopTrackingDevices: (): void => typedIpcRenderer.send('adb:stop-tracking-devices'),
    onDeviceAdded: (callback: (device: DeviceInfo) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, device: DeviceInfo): void => callback(device)
      typedIpcRenderer.on('adb:device-added', listener)
      return () => typedIpcRenderer.removeListener('adb:device-added', listener)
    },
    onDeviceRemoved: (callback: (device: DeviceInfo) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, device: DeviceInfo): void => callback(device)
      typedIpcRenderer.on('adb:device-removed', listener)
      return () => typedIpcRenderer.removeListener('adb:device-removed', listener)
    },
    onDeviceChanged: (callback: (device: DeviceInfo) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, device: DeviceInfo): void => callback(device)
      typedIpcRenderer.on('adb:device-changed', listener)
      return () => typedIpcRenderer.removeListener('adb:device-changed', listener)
    },
    onTrackerError: (callback: (error: string) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, error: string): void => callback(error)
      typedIpcRenderer.on('adb:device-tracker-error', listener)
      return () => typedIpcRenderer.removeListener('adb:device-tracker-error', listener)
    },
    onInstallationCompleted: (callback: (deviceId: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, deviceId: string): void => callback(deviceId)
      typedIpcRenderer.on('adb:installation-completed', listener)
      return () => typedIpcRenderer.removeListener('adb:installation-completed', listener)
    },
    getApplicationLabel: (serial: string, packageName: string): Promise<string | null> =>
      typedIpcRenderer.invoke('adb:get-application-label', serial, packageName)
  } satisfies AdbAPIRenderer,
  games: {
    getGames: (): Promise<GameInfo[]> => typedIpcRenderer.invoke('games:get-games'),
    getBlacklistGames: () => typedIpcRenderer.invoke('games:get-blacklist-games'),
    getNote: (releaseName: string): Promise<string> =>
      typedIpcRenderer.invoke('games:get-note', releaseName),
    getLastSyncTime: (): Promise<Date | null> =>
      typedIpcRenderer.invoke('games:get-last-sync-time'),
    forceSync: (): Promise<GameInfo[]> => typedIpcRenderer.invoke('games:force-sync-games'),
    getTrailerVideoId: (gameName: string): Promise<string | null> =>
      typedIpcRenderer.invoke('games:get-trailer-video-id', gameName),
    onDownloadProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, progress: DownloadProgress): void => callback(progress)
      typedIpcRenderer.on('games:download-progress', listener)
      return () => typedIpcRenderer.removeListener('games:download-progress', listener)
    },
    addToBlacklist: (packageName: string, version?: number | 'any'): Promise<boolean> =>
      typedIpcRenderer.invoke('games:add-to-blacklist', packageName, version),
    removeFromBlacklist: (packageName: string): Promise<boolean> =>
      typedIpcRenderer.invoke('games:remove-from-blacklist', packageName),
    isGameBlacklisted: (packageName: string, version?: number): Promise<boolean> =>
      typedIpcRenderer.invoke('games:is-game-blacklisted', packageName, version)
  } satisfies GameAPIRenderer,
  // Download Queue APIs
  downloads: {
    getQueue: (): Promise<DownloadItem[]> => typedIpcRenderer.invoke('download:get-queue'),
    addToQueue: (game: GameInfo): Promise<boolean> => typedIpcRenderer.invoke('download:add', game),
    removeFromQueue: (releaseName: string): void =>
      typedIpcRenderer.send('download:remove', releaseName),
    cancelUserRequest: (releaseName: string): void =>
      typedIpcRenderer.send('download:cancel', releaseName),
    retryDownload: (releaseName: string): void =>
      typedIpcRenderer.send('download:retry', releaseName),
    deleteDownloadedFiles: (releaseName: string): Promise<boolean> =>
      typedIpcRenderer.invoke('download:delete-files', releaseName),
    installFromCompleted: (releaseName: string, deviceId: string): Promise<void> =>
      typedIpcRenderer.invoke('download:install-from-completed', releaseName, deviceId),
    onQueueUpdated: (callback: (queue: DownloadItem[]) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, queue: DownloadItem[]): void => callback(queue)
      typedIpcRenderer.on('download:queue-updated', listener)
      return () => typedIpcRenderer.removeListener('download:queue-updated', listener)
    },
    setDownloadPath: (path: string): void =>
      typedIpcRenderer.send('download:set-download-path', path)
  } satisfies DownloadAPIRenderer,
  // Upload APIs
  uploads: {
    prepareUpload: (
      packageName: string,
      gameName: string,
      versionCode: number,
      deviceId: string
    ): Promise<string | null> =>
      typedIpcRenderer.invoke('upload:prepare', packageName, gameName, versionCode, deviceId),
    getQueue: (): Promise<UploadItem[]> => typedIpcRenderer.invoke('upload:get-queue'),
    addToQueue: (
      packageName: string,
      gameName: string,
      versionCode: number,
      deviceId: string
    ): Promise<boolean> =>
      typedIpcRenderer.invoke('upload:add-to-queue', packageName, gameName, versionCode, deviceId),
    removeFromQueue: (packageName: string): void =>
      typedIpcRenderer.send('upload:remove', packageName),
    cancelUpload: (packageName: string): void =>
      typedIpcRenderer.send('upload:cancel', packageName),
    onUploadProgress: (callback: (progress: UploadPreparationProgress) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, progress: UploadPreparationProgress): void =>
        callback(progress)
      typedIpcRenderer.on('upload:progress', listener)
      return () => typedIpcRenderer.removeListener('upload:progress', listener)
    },
    onQueueUpdated: (callback: (queue: UploadItem[]) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, queue: UploadItem[]): void => callback(queue)
      typedIpcRenderer.on('upload:queue-updated', listener)
      return () => typedIpcRenderer.removeListener('upload:queue-updated', listener)
    }
  } satisfies UploadAPIRenderer,
  // Update APIs
  updates: {
    checkForUpdates: (): Promise<void> => typedIpcRenderer.invoke('update:check-for-updates'),
    openDownloadPage: (url: string): void => typedIpcRenderer.send('update:download', url),
    onCheckingForUpdate: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      typedIpcRenderer.on('update:checking-for-update', listener)
      return () => typedIpcRenderer.removeListener('update:checking-for-update', listener)
    },
    onUpdateAvailable: (callback: (info: UpdateInfo) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, info: UpdateInfo): void => callback(info)
      typedIpcRenderer.on('update:update-available', listener)
      return () => typedIpcRenderer.removeListener('update:update-available', listener)
    },
    onUpdateError: (callback: (error: Error) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, error: Error): void => callback(error)
      typedIpcRenderer.on('update:error', listener)
      return () => typedIpcRenderer.removeListener('update:error', listener)
    }
  } satisfies UpdateAPIRenderer,
  settings: {
    getDownloadPath: (): Promise<string> => typedIpcRenderer.invoke('settings:get-download-path'),
    setDownloadPath: (path: string): Promise<void> =>
      typedIpcRenderer.invoke('settings:set-download-path', path),
    getDownloadSpeedLimit: (): Promise<number> =>
      typedIpcRenderer.invoke('settings:get-download-speed-limit'),
    setDownloadSpeedLimit: (limit: number): Promise<void> =>
      typedIpcRenderer.invoke('settings:set-download-speed-limit', limit),
    getUploadSpeedLimit: (): Promise<number> =>
      typedIpcRenderer.invoke('settings:get-upload-speed-limit'),
    setUploadSpeedLimit: (limit: number): Promise<void> =>
      typedIpcRenderer.invoke('settings:set-upload-speed-limit', limit)
  } satisfies SettingsAPIRenderer,
  // Add dialog API
  dialog: {
    showDirectoryPicker: (): Promise<string | null> =>
      typedIpcRenderer.invoke('dialog:show-directory-picker')
  },
  // Dependency Status Listeners
  onDependencyProgress: (
    callback: (status: DependencyStatus, progress: { name: string; percentage: number }) => void
  ): (() => void) => {
    const listener = (
      _: IpcRendererEvent,
      status: DependencyStatus,
      progress: { name: string; percentage: number }
    ): void => callback(status, progress)
    typedIpcRenderer.on('dependency-progress', listener)
    return () => typedIpcRenderer.removeListener('dependency-progress', listener)
  },
  onDependencySetupComplete: (callback: (status: DependencyStatus) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, status: DependencyStatus): void => callback(status)
    typedIpcRenderer.on('dependency-setup-complete', listener)
    return () => typedIpcRenderer.removeListener('dependency-setup-complete', listener)
  },
  onDependencySetupError: (
    callback: (errorInfo: { message: string; status: DependencyStatus }) => void
  ): (() => void) => {
    const listener = (
      _: IpcRendererEvent,
      errorInfo: { message: string; status: DependencyStatus }
    ): void => callback(errorInfo)
    typedIpcRenderer.on('dependency-setup-error', listener)
    return () => typedIpcRenderer.removeListener('dependency-setup-error', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in d.ts file for type safety)
  window.electron = electronAPI
  // @ts-ignore (define in d.ts file for type safety)
  window.api = api
}
