import { createContext } from 'react'
import { AdbContextType } from '@shared/types'

export const AdbContext = createContext<AdbContextType | undefined>(undefined)
