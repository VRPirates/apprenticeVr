import { useContext } from 'react'
import { GamesContext, GamesContextType } from '../context/GamesContext'

export const useGames = (): GamesContextType => {
  const context = useContext(GamesContext)
  if (context === undefined) {
    throw new Error('useGames must be used within a GamesProvider')
  }
  return context
}
