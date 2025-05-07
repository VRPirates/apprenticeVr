import { createContext } from 'react'
import { DependencyStatus } from '../types/adb'

export interface DependencyContextType {
  isReady: boolean
  status: DependencyStatus | null
  error: string | null
  progress: { name: string; percentage: number } | null
}

export const DependencyContext = createContext<DependencyContextType | undefined>(undefined)
