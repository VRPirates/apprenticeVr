import { useContext } from 'react'
import { DependencyContext, DependencyContextType } from '../context/DependencyContext'

export const useDependency = (): DependencyContextType => {
  const context = useContext(DependencyContext)
  if (context === undefined) {
    throw new Error('useDependency must be used within a DependencyProvider')
  }
  return context
}
