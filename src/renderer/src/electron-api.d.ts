import { IpcRenderer } from 'electron'
import { GameInfo, DeviceInfo, PackageInfo } from './types/adb' // Ensure PackageInfo is imported or defined if needed

declare global {
  interface Window {
    ipcRenderer: IpcRenderer
    api: {
      adb: {
        listDevices: () => Promise<DeviceInfo[]>
        connectDevice: (serial: string) => Promise<boolean> // Assuming boolean indicates success
        disconnectDevice: () => Promise<void>
        getInstalledPackages: (serial: string) => Promise<PackageInfo[]>
        getPackageVersionCode: (serial: string, packageName: string) => Promise<number | null> // Added type
        startTrackingDevices: () => void
        stopTrackingDevices: () => void
        onDeviceAdded: (callback: (device: DeviceInfo) => void) => () => void
        onDeviceRemoved: (callback: (device: DeviceInfo) => void) => () => void
        onDeviceChanged: (callback: (device: DeviceInfo) => void) => () => void
        // Removed onTrackerError as it wasn't in the final preload
      }
      games: {
        getGames: () => Promise<GameInfo[]>
        getLastSyncTime: () => Promise<string | null> // Returns ISO string
        forceSync: () => Promise<GameInfo[]>
        onDownloadProgress: (
          callback: (progress: { type: string; progress: number }) => void
        ) => () => void
        onExtractProgress: (
          callback: (progress: { type: string; progress: number }) => void
        ) => () => void
      }
    }
  }
}
