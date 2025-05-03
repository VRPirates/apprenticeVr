import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Define device info interface
interface DeviceInfo {
  id: string
  type: string
  [key: string]: unknown
}

// Define game info interface
interface GameInfo {
  id: string
  name: string
  size?: string
  version?: string
  [key: string]: unknown
}

// Define download progress interface
interface DownloadProgress {
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
    onExtractProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
      const listener = (_: unknown, progress: DownloadProgress): void => callback(progress)
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
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
