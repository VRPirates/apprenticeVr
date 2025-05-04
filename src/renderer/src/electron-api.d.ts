import { IpcRenderer } from 'electron'
import { GameInfo, AdbAPI } from './types/adb' // Ensure PackageInfo is imported or defined if needed

interface DependencyStatus {
  // Define this type if not already present
  sevenZip: {
    ready: boolean
    path: string | null
    error: string | null
    downloading: boolean
  }
}

declare global {
  interface Window {
    ipcRenderer: IpcRenderer
    api: {
      initializeDependencies: () => void
      initializeGameService: () => Promise<void>
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
      onDependencyProgress: (
        callback: (progress: { name: string; percentage: number }) => void
      ) => () => void
      onDependencySetupComplete: (callback: (status: DependencyStatus) => void) => () => void
      onDependencySetupError: (
        callback: (errorInfo: { message: string; status: DependencyStatus }) => void
      ) => () => void
    }
  }
}
