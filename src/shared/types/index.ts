/**
 * Shared type definitions for both main and renderer processes
 */

import { BrowserWindow } from 'electron'

type Modify<T, R> = Omit<T, keyof R> & R

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
  versionCode: number
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

export interface UploadCandidate {
  packageName: string
  gameName: string
  versionCode: number
  reason: 'missing' | 'newer'
  storeVersion?: string
}

// Upload types
export interface UploadPreparationProgress {
  packageName: string
  stage: string
  progress: number
}

export type UploadStatus =
  | 'Queued'
  | 'Preparing'
  | 'Uploading'
  | 'Completed'
  | 'Error'
  | 'Cancelled'

export interface UploadItem {
  packageName: string
  gameName: string
  versionCode: number
  deviceId: string
  status: UploadStatus
  progress: number
  stage?: string
  error?: string
  addedDate: number
  zipPath?: string
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
  downloadPath: string
  pid?: number
  addedDate: number
  thumbnailPath?: string
  speed?: string
  eta?: string
  extractProgress?: number
}

export interface DownloadProgress {
  packageName: string
  stage: 'download' | 'extract' | 'copy' | 'install'
  progress: number
}

// Update types
export interface UpdateInfo {
  version: string
  releaseNotes?: string
  releaseDate?: string
  downloadUrl?: string
}

export interface UpdateProgressInfo {
  bytesPerSecond: number
  percent: number
  transferred: number
  total: number
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
  getApplicationLabel: (serial: string, packageName: string) => Promise<string | null>
  uninstallPackage: (serial: string, packageName: string) => Promise<boolean>
  startTrackingDevices: (mainWindow?: BrowserWindow) => void
  stopTrackingDevices: () => void
}

export interface DependencyAPI {
  getStatus: () => Promise<DependencyStatus>
}

export interface DependencyAPIRenderer extends DependencyAPI {}

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
  getBlacklistGames: () => Promise<string[]>
  getTrailerVideoId: (gameName: string) => Promise<string | null>
}

export interface GameAPIRenderer extends GamesAPI {
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
}

export interface DownloadAPI {
  getQueue: () => Promise<DownloadItem[]>
  addToQueue: (game: GameInfo) => Promise<boolean>
  removeFromQueue: (releaseName: string) => void
  cancelUserRequest: (releaseName: string) => void
  retryDownload: (releaseName: string) => void
  deleteDownloadedFiles: (releaseName: string) => Promise<boolean>
  setDownloadPath: (path: string) => void
}

export interface DownloadAPIRenderer extends DownloadAPI {
  onQueueUpdated: (callback: (queue: DownloadItem[]) => void) => () => void
  installFromCompleted: (releaseName: string, deviceId: string) => Promise<void>
}

export interface UploadAPI {
  prepareUpload: (
    packageName: string,
    gameName: string,
    versionCode: number,
    deviceId: string
  ) => Promise<string | null>
  getQueue: () => Promise<UploadItem[]>
  addToQueue: (
    packageName: string,
    gameName: string,
    versionCode: number,
    deviceId: string
  ) => Promise<boolean>
  removeFromQueue: (packageName: string) => void
  cancelUpload: (packageName: string) => void
}

export interface UploadAPIRenderer extends UploadAPI {
  onUploadProgress: (callback: (progress: UploadPreparationProgress) => void) => () => void
  onQueueUpdated: (callback: (queue: UploadItem[]) => void) => () => void
}

// Update API
export interface UpdateAPI {
  checkForUpdates: () => Promise<void>
  openDownloadPage: (url: string) => void
}

export interface UpdateAPIRenderer extends UpdateAPI {
  onCheckingForUpdate: (callback: () => void) => () => void
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void
  onUpdateError: (callback: (error: Error) => void) => () => void
}

export interface Settings {
  downloadPath: string
  downloadSpeedLimit: number
  uploadSpeedLimit: number
}

export interface SettingsAPI {
  getDownloadPath: () => string
  setDownloadPath: (path: string) => void
  getDownloadSpeedLimit: () => number
  setDownloadSpeedLimit: (limit: number) => void
  getUploadSpeedLimit: () => number
  setUploadSpeedLimit: (limit: number) => void
}

export interface SettingsAPIRenderer
  extends Modify<
    SettingsAPI,
    {
      getDownloadPath: () => Promise<string>
      setDownloadPath: (path: string) => Promise<void>
      getDownloadSpeedLimit: () => Promise<number>
      setDownloadSpeedLimit: (limit: number) => Promise<void>
      getUploadSpeedLimit: () => Promise<number>
      setUploadSpeedLimit: (limit: number) => Promise<void>
    }
  > {}

export type ServiceStatus = 'NOT_INITIALIZED' | 'INITIALIZING' | 'INITIALIZED' | 'ERROR'
