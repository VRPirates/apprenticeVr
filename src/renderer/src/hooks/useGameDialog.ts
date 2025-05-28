import { useContext } from 'react'
import { GameDialogContext, GameDialogContextType } from '../context/GameDialogContext'

export const useGameDialog = (): GameDialogContextType => {
  const context = useContext(GameDialogContext)
  if (context === undefined) {
    throw new Error('useGameDialog must be used within a GameDialogProvider')
  }
  return context
}
