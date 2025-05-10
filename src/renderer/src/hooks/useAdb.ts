import { useContext } from 'react'
import { AdbContext } from '../context/AdbContext'
import { AdbContextType } from '@shared/types'

export const useAdb = (): AdbContextType => {
  const context = useContext(AdbContext)
  if (context === undefined) {
    throw new Error('useAdb must be used within an AdbProvider')
  }
  return context
}
