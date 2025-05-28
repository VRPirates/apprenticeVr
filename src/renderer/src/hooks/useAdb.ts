import { useContext } from 'react'
import { AdbContext, AdbContextType } from '../context/AdbContext'

export const useAdb = (): AdbContextType => {
  const context = useContext(AdbContext)
  if (context === undefined) {
    throw new Error('useAdb must be used within an AdbProvider')
  }
  return context
}
