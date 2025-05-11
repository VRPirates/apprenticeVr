import { createContext } from 'react'

export interface SettingsContextType {
  downloadPath: string
  isLoading: boolean
  error: string | null
  setDownloadPath: (path: string) => Promise<void>
}

export const SettingsContext = createContext<SettingsContextType | undefined>(undefined)
