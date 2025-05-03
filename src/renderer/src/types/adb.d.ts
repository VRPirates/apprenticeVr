export interface DeviceInfo {
  id: string
  type: string
  [key: string]: unknown
}

export interface PackageInfo {
  packageName: string
  // More metadata fields will be added in the future
}

export interface GameInfo {
  id: string
  name: string
  packageName: string
  version: string
  size: string
  lastUpdated: string
  releaseName: string
  downloads: number
  thumbnailPath: string
  isInstalled?: boolean
}

export interface DownloadProgress {
  type: string
  progress: number
}

export interface AdbContextType {
  devices: DeviceInfo[]
  selectedDevice: string | null
  isConnected: boolean
  isLoading: boolean
  error: string | null
  packages: PackageInfo[]
  loadingPackages: boolean
  connectToDevice: (serial: string) => Promise<boolean>
  refreshDevices: () => Promise<void>
  disconnectDevice: () => void
  loadPackages: () => Promise<void>
}

export interface AdbAPI {
  listDevices: () => Promise<DeviceInfo[]>
  connectDevice: (serial: string) => Promise<boolean>
  getInstalledPackages: (serial: string) => Promise<PackageInfo[]>
  startTrackingDevices: () => void
  stopTrackingDevices: () => void
  onDeviceAdded: (callback: (device: DeviceInfo) => void) => () => void
  onDeviceRemoved: (callback: (device: DeviceInfo) => void) => () => void
  onDeviceChanged: (callback: (device: DeviceInfo) => void) => () => void
  onTrackerError: (callback: (error: string) => void) => () => void
}

export interface GamesAPI {
  getGames: () => Promise<GameInfo[]>
  getLastSyncTime: () => Promise<Date | null>
  forceSync: () => Promise<GameInfo[]>
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
  onExtractProgress: (callback: (progress: DownloadProgress) => void) => () => void
}

declare global {
  interface Window {
    api: {
      adb: AdbAPI
      games: GamesAPI
    }
  }
}
