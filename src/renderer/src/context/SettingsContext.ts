import { createContext } from 'react'

export interface SettingsContextType {
  downloadPath: string
  downloadSpeedLimit: number
  uploadSpeedLimit: number
  colorScheme: 'light' | 'dark'
  isLoading: boolean
  error: string | null
  setDownloadPath: (path: string) => Promise<void>
  setDownloadSpeedLimit: (limit: number) => Promise<void>
  setUploadSpeedLimit: (limit: number) => Promise<void>
  setColorScheme: (scheme: 'light' | 'dark') => Promise<void>
}

export const SettingsContext = createContext<SettingsContextType | undefined>(undefined)
