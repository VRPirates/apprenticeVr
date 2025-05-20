import { createContext } from 'react'

export interface SettingsContextType {
  downloadPath: string
  downloadSpeedLimit: number
  uploadSpeedLimit: number
  hideAdultContent: boolean
  isLoading: boolean
  error: string | null
  setDownloadPath: (path: string) => Promise<void>
  setDownloadSpeedLimit: (limit: number) => Promise<void>
  setUploadSpeedLimit: (limit: number) => Promise<void>
  setHideAdultContent: (hide: boolean) => Promise<void>
}

export const SettingsContext = createContext<SettingsContextType | undefined>(undefined)
