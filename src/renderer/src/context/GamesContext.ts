import { createContext } from 'react'
import { GameInfo } from '../types/adb'

export interface GamesContextType {
  games: GameInfo[]
  isLoading: boolean
  error: string | null
  lastSyncTime: Date | null
  downloadProgress: number
  extractProgress: number
  refreshGames: () => Promise<void>
  getNote: (releaseName: string) => Promise<string>
}

export const GamesContext = createContext<GamesContextType | undefined>(undefined)
