import { IpcRenderer } from 'electron'
import { GameInfo, AdbAPI, DependencyStatus, DownloadItem } from './types/adb' // Import DownloadItem

// REMOVE local DependencyStatus definition if present
// interface DependencyStatus { ... }

declare global {
  interface Window {
    ipcRenderer: IpcRenderer
    api: {
      initializeDependencies: () => void
      initializeGameService: () => Promise<void>
      initializeADBService: () => Promise<void>
      adb: AdbAPI
      games: {
        getGames: () => Promise<GameInfo[]>
        getNote: (releaseName: string) => Promise<string>
        getLastSyncTime: () => Promise<string | null> // Returns ISO string
        forceSync: () => Promise<GameInfo[]>
        onDownloadProgress: (
          callback: (progress: { type: string; progress: number }) => void
        ) => () => void
        onExtractProgress: (
          callback: (progress: { type: string; progress: number }) => void
        ) => () => void
      }
      downloads: {
        getQueue: () => Promise<DownloadItem[]>
        add: (game: GameInfo) => Promise<boolean>
        remove: (releaseName: string) => void
        cancel: (releaseName: string) => void
        retry: (releaseName: string) => void
        onQueueUpdated: (callback: (queue: DownloadItem[]) => void) => () => void
        deleteFiles(releaseName: string): Promise<boolean>
        installFromCompleted: (releaseName: string, deviceId: string) => Promise<void>
      }
      onDependencyProgress: (
        callback: (status: DependencyStatus, progress: { name: string; percentage: number }) => void
      ) => () => void
      onDependencySetupComplete: (
        callback: (status: DependencyStatus) => void // Uses imported type
      ) => () => void
      onDependencySetupError: (
        callback: (errorInfo: { message: string; status: DependencyStatus }) => void // Uses imported type
      ) => () => void
    }
  }
}
