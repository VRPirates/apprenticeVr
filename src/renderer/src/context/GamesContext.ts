import { createContext } from 'react'
import { GameInfo, UploadCandidate } from '@shared/types'

export interface GamesContextType {
  games: GameInfo[]
  localGames: GameInfo[]
  uploadCandidates: UploadCandidate[]
  isLoading: boolean
  error: string | null
  lastSyncTime: Date | null
  downloadProgress: number
  extractProgress: number
  refreshGames: () => Promise<void>
  loadGames: () => Promise<void>
  getNote: (releaseName: string) => Promise<string>
  isInitialLoadComplete: boolean
}

export const GamesContext = createContext<GamesContextType | undefined>(undefined)
