import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { GameInfo } from '../main/services/gameService'
import { DependencyStatus } from '../renderer/src/types/adb'
import { DownloadItem } from '../main/services/download/types'

// Type definitions (consider moving to a shared types file)
interface DeviceInfo {
  id: string
  type: string
}

interface DownloadProgress {
  type: string
  progress: number
}

interface ExtractProgress {
  type: string
  progress: number
}

// Custom APIs for renderer
const api = {
  initializeDependencies: (): void => ipcRenderer.send('initialize-dependencies'),
  initializeGameService: (): Promise<void> => ipcRenderer.invoke('initialize-game-service'),
  initializeADBService: (): Promise<void> => ipcRenderer.invoke('initialize-adb-service'),
  adb: {
    listDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke('list-devices'),
    connectDevice: (serial: string): Promise<boolean> =>
      ipcRenderer.invoke('connect-device', serial),
    getInstalledPackages: (serial: string): Promise<Array<{ packageName: string }>> =>
      ipcRenderer.invoke('get-installed-packages', serial),
    getPackageVersionCode: (serial: string, packageName: string): Promise<number | null> =>
      ipcRenderer.invoke('adb:getPackageVersionCode', serial, packageName),
    uninstallPackage: (serial: string, packageName: string): Promise<boolean> =>
      ipcRenderer.invoke('adb:uninstallPackage', serial, packageName),
    startTrackingDevices: (): void => ipcRenderer.send('start-tracking-devices'),
    stopTrackingDevices: (): void => ipcRenderer.send('stop-tracking-devices'),
    onDeviceAdded: (callback: (device: DeviceInfo) => void): (() => void) => {
      const listener = (_: unknown, device: DeviceInfo): void => callback(device)
      ipcRenderer.on('device-added', listener)
      return () => ipcRenderer.removeListener('device-added', listener)
    },
    onDeviceRemoved: (callback: (device: DeviceInfo) => void): (() => void) => {
      const listener = (_: unknown, device: DeviceInfo): void => callback(device)
      ipcRenderer.on('device-removed', listener)
      return () => ipcRenderer.removeListener('device-removed', listener)
    },
    onDeviceChanged: (callback: (device: DeviceInfo) => void): (() => void) => {
      const listener = (_: unknown, device: DeviceInfo): void => callback(device)
      ipcRenderer.on('device-changed', listener)
      return () => ipcRenderer.removeListener('device-changed', listener)
    },
    onTrackerError: (callback: (error: string) => void): (() => void) => {
      const listener = (_: unknown, error: string): void => callback(error)
      ipcRenderer.on('device-tracker-error', listener)
      return () => ipcRenderer.removeListener('device-tracker-error', listener)
    },
    onInstallationCompleted: (callback: (deviceId: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, deviceId: string): void => callback(deviceId)
      ipcRenderer.on('installation-completed', listener)
      return () => ipcRenderer.removeListener('installation-completed', listener)
    }
  },
  games: {
    getGames: (): Promise<GameInfo[]> => ipcRenderer.invoke('get-games'),
    getNote: (releaseName: string): Promise<string> => ipcRenderer.invoke('get-note', releaseName),
    getLastSyncTime: (): Promise<Date | null> => ipcRenderer.invoke('get-last-sync-time'),
    forceSync: (): Promise<GameInfo[]> => ipcRenderer.invoke('force-sync-games'),
    onDownloadProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
      const listener = (_: unknown, progress: DownloadProgress): void => callback(progress)
      ipcRenderer.on('download-progress', listener)
      return () => ipcRenderer.removeListener('download-progress', listener)
    },
    onExtractProgress: (callback: (progress: ExtractProgress) => void): (() => void) => {
      const listener = (_: unknown, progress: ExtractProgress): void => callback(progress)
      ipcRenderer.on('extract-progress', listener)
      return () => ipcRenderer.removeListener('extract-progress', listener)
    }
  },
  // Download Queue APIs
  downloads: {
    getQueue: (): Promise<DownloadItem[]> => ipcRenderer.invoke('download:getQueue'),
    add: (game: GameInfo): Promise<boolean> => ipcRenderer.invoke('download:add', game),
    remove: (releaseName: string): void => ipcRenderer.send('download:remove', releaseName),
    cancel: (releaseName: string): void => ipcRenderer.send('download:cancel', releaseName),
    retry: (releaseName: string): void => ipcRenderer.send('download:retry', releaseName),
    deleteFiles: (releaseName: string): Promise<boolean> =>
      ipcRenderer.invoke('download:delete-files', releaseName),
    installFromCompleted: (releaseName: string, deviceId: string): Promise<void> =>
      ipcRenderer.invoke('download:install-from-completed', releaseName, deviceId),
    onQueueUpdated: (callback: (queue: DownloadItem[]) => void): (() => void) => {
      const listener = (_: unknown, queue: DownloadItem[]): void => callback(queue)
      ipcRenderer.on('download:queue-updated', listener)
      return () => ipcRenderer.removeListener('download:queue-updated', listener)
    }
  },
  // Dependency Status Listeners
  onDependencyProgress: (
    callback: (status: DependencyStatus, progress: { name: string; percentage: number }) => void
  ): (() => void) => {
    const listener = (
      _: unknown,
      status: DependencyStatus,
      progress: { name: string; percentage: number }
    ): void => callback(status, progress)
    ipcRenderer.on('dependency-progress', listener)
    return () => ipcRenderer.removeListener('dependency-progress', listener)
  },
  onDependencySetupComplete: (callback: (status: DependencyStatus) => void): (() => void) => {
    const listener = (_: unknown, status: DependencyStatus): void => callback(status)
    ipcRenderer.on('dependency-setup-complete', listener)
    return () => ipcRenderer.removeListener('dependency-setup-complete', listener)
  },
  onDependencySetupError: (
    callback: (errorInfo: { message: string; status: DependencyStatus }) => void
  ): (() => void) => {
    const listener = (_: unknown, errorInfo: { message: string; status: DependencyStatus }): void =>
      callback(errorInfo)
    ipcRenderer.on('dependency-setup-error', listener)
    return () => ipcRenderer.removeListener('dependency-setup-error', listener)
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
