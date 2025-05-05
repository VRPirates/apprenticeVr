import { createContext } from 'react'
import { DownloadItem, GameInfo } from '../types/adb'

export interface DownloadContextType {
  queue: DownloadItem[]
  isLoading: boolean
  error: string | null
  addToQueue: (game: GameInfo) => Promise<boolean>
  removeFromQueue: (releaseName: string) => void
  cancelDownload: (releaseName: string) => void
  retryDownload: (releaseName: string) => void
  deleteFiles: (releaseName: string) => Promise<boolean>
}

export const DownloadContext = createContext<DownloadContextType | undefined>(undefined)
