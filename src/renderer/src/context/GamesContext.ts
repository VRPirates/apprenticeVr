import { createContext } from 'react'
import { GameInfo } from '../types/adb'

// Base interface (only game-related state)
export interface GamesContextType {
  games: GameInfo[]
  isLoading: boolean // Reflects game loading/syncing
  error: string | null // Game loading/syncing error
  lastSyncTime: Date | null
  downloadProgress: number // Game data download
  extractProgress: number // Game data extract
  refreshGames: () => Promise<void>
  getNote: (releaseName: string) => Promise<string>
  isInitialLoadComplete: boolean
}

// Create the context with the BASE type
export const GamesContext = createContext<GamesContextType | undefined>(undefined)
