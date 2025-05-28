import { createContext, SetStateAction } from 'react'
import { GameInfo } from '@shared/types'

export type GameDialogContextType = [
  GameInfo | null,
  React.Dispatch<SetStateAction<GameInfo | null>>
]

export const GameDialogContext = createContext<GameDialogContextType | undefined>(undefined)
