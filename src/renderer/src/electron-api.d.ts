import { IpcRenderer } from 'electron'
import {
  AdbAPIRenderer,
  DependencyStatus,
  DownloadAPIRenderer,
  GameAPIRenderer
} from '@shared/types'

declare global {
  interface Window {
    ipcRenderer: IpcRenderer
    api: {
      initializeDependencies: () => void
      adb: AdbAPIRenderer
      games: GameAPIRenderer
      downloads: DownloadAPIRenderer
      // deleteFiles(releaseName: string): Promise<boolean>
      // installFromCompleted: (releaseName: string, deviceId: string) => Promise<void>
      onDependencyProgress: (
        callback: (status: DependencyStatus, progress: { name: string; percentage: number }) => void
      ) => () => void
      onDependencySetupComplete: (callback: (status: DependencyStatus) => void) => () => void
      onDependencySetupError: (
        callback: (errorInfo: { message: string; status: DependencyStatus }) => void
      ) => () => void
    }
  }
}
