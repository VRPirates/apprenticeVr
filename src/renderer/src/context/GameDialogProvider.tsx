import React, { ReactNode, useState, useEffect } from 'react'
import { GameDialogContext, GameDialogContextType } from './GameDialogContext'
import { useGames } from '../hooks/useGames'
import { GameInfo } from '@shared/types'

interface GameDialogProviderProps {
  children: ReactNode
}

export const GameDialogProvider: React.FC<GameDialogProviderProps> = ({ children }) => {
  const [dialogGame, setDialogGame] = useState<GameInfo | null>(null)
  const { games } = useGames()

  useEffect(() => {
    setDialogGame((currentDialogGame) => {
      if (!currentDialogGame) return null

      const updatedGame = games.find(
        (game) =>
          game.id === currentDialogGame.id && game.releaseName === currentDialogGame.releaseName
      )

      if (updatedGame) {
        return updatedGame
      }

      return null
    })
  }, [games])

  const value: GameDialogContextType = [dialogGame, setDialogGame]

  return <GameDialogContext.Provider value={value}>{children}</GameDialogContext.Provider>
}
