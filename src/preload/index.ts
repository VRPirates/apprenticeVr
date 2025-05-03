import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { GameInfo } from '../main/services/gameService'

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
  adb: {
    listDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke('list-devices'),
    connectDevice: (serial: string): Promise<boolean> =>
      ipcRenderer.invoke('connect-device', serial),
    getInstalledPackages: (serial: string): Promise<Array<{ packageName: string }>> =>
      ipcRenderer.invoke('get-installed-packages', serial),
    getPackageVersionCode: (serial: string, packageName: string): Promise<number | null> =>
      ipcRenderer.invoke('adb:getPackageVersionCode', serial, packageName),
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
    }
  },
  games: {
    getGames: (): Promise<GameInfo[]> => ipcRenderer.invoke('get-games'),
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
