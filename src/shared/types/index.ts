/**
 * Shared type definitions for both main and renderer processes
 */

import { BrowserWindow } from 'electron'

// Device types
export interface DeviceInfo {
  id: string
  type: 'emulator' | 'device' | 'offline' | 'unauthorized' | 'unknown'
  model: string | null
  isQuestDevice: boolean
  batteryLevel: number | null
  storageTotal: string | null
  storageFree: string | null
  friendlyModelName: string | null
  [key: string]: unknown
}

export interface PackageInfo {
  packageName: string
  // More metadata fields will be added in the future
}

// Game types
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
  notePath: string
  isInstalled: boolean
  deviceVersionCode?: number
  hasUpdate?: boolean
}

// Download types
export type DownloadStatus =
  | 'Queued'
  | 'Downloading'
  | 'Completed'
  | 'Error'
  | 'Cancelled'
  | 'Extracting'
  | 'Installing'
  | 'InstallError'

export interface DownloadItem {
  gameId: string
  releaseName: string
  gameName: string
  packageName: string
  status: DownloadStatus
  progress: number
  error?: string
  downloadPath?: string
  pid?: number
  addedDate: number
  thumbnailPath?: string
  speed?: string
  eta?: string
  extractProgress?: number
}

export interface DownloadProgress {
  type: string
  progress: number
}

// Dependency types
export interface DependencyStatus {
  sevenZip: {
    ready: boolean
    path: string | null
    error: string | null
  }
  rclone: {
    ready: boolean
    path: string | null
    error: string | null
    downloading: boolean
  }
  adb: {
    ready: boolean
    path: string | null
    error: string | null
    downloading: boolean
  }
}

// API types
export interface AdbContextType {
  devices: DeviceInfo[]
  selectedDevice: string | null
  selectedDeviceDetails: DeviceInfo | null
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
  getPackageVersionCode: (serial: string, packageName: string) => Promise<number | null>
  uninstallPackage: (serial: string, packageName: string) => Promise<boolean>
  startTrackingDevices: (mainWindow?: BrowserWindow) => void
  stopTrackingDevices: () => void
}

export interface AdbAPIRenderer extends AdbAPI {
  onDeviceAdded: (callback: (device: DeviceInfo) => void) => () => void
  onDeviceRemoved: (callback: (device: DeviceInfo) => void) => () => void
  onDeviceChanged: (callback: (device: DeviceInfo) => void) => () => void
  onTrackerError: (callback: (error: string) => void) => () => void
  onInstallationCompleted: (callback: (deviceId: string) => void) => () => void
}

export interface GamesAPI {
  getGames: () => Promise<GameInfo[]>
  getLastSyncTime: () => Promise<Date | null>
  forceSync: () => Promise<GameInfo[]>
  getNote: (releaseName: string) => Promise<string>
}

export interface GameAPIRenderer extends GamesAPI {
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
  onExtractProgress: (callback: (progress: DownloadProgress) => void) => () => void
}

export interface DownloadAPI {
  getQueue: () => Promise<DownloadItem[]>
  addToQueue: (game: GameInfo) => Promise<boolean>
  removeFromQueue: (releaseName: string) => void
  cancelUserRequest: (releaseName: string) => void
  retryDownload: (releaseName: string) => void
  deleteDownloadedFiles: (releaseName: string) => Promise<boolean>
}

export interface DownloadAPIRenderer extends DownloadAPI {
  onQueueUpdated: (callback: (queue: DownloadItem[]) => void) => () => void
  installFromCompleted: (releaseName: string, deviceId: string) => Promise<void>
}

export type ServiceStatus = 'NOT_INITIALIZED' | 'INITIALIZING' | 'INITIALIZED' | 'ERROR'
