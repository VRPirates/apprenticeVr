import { IpcRenderer } from 'electron'
import {
  AdbAPIRenderer,
  DependencyStatus,
  DownloadAPIRenderer,
  GameAPIRenderer,
  SettingsAPIRenderer,
  UploadAPIRenderer
} from '@shared/types'

declare global {
  interface Window {
    ipcRenderer: IpcRenderer
    api: {
      initializeDependencies: () => void
      adb: AdbAPIRenderer
      games: GameAPIRenderer
      downloads: DownloadAPIRenderer
      settings: SettingsAPIRenderer
      uploads: UploadAPIRenderer
      dialog: {
        showDirectoryPicker: () => Promise<string | null>
      }
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
