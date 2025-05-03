import { createContext } from 'react'
import { AdbContextType } from '../types/adb'

export const AdbContext = createContext<AdbContextType | undefined>(undefined)
