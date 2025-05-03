import { IpcRenderer } from 'electron'
import { GameInfo, AdbAPI } from './types/adb' // Ensure PackageInfo is imported or defined if needed

declare global {
  interface Window {
    ipcRenderer: IpcRenderer
    api: {
      adb: AdbAPI
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
