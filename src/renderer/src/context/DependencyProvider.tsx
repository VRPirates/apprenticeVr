import React, { ReactNode, useEffect, useState } from 'react'
import { DependencyContext, DependencyContextType } from './DependencyContext'
import { DependencyStatus } from '../types/adb'

interface DependencyProviderProps {
  children: ReactNode
}

export const DependencyProvider: React.FC<DependencyProviderProps> = ({ children }) => {
  const [isReady, setIsReady] = useState<boolean>(false)
  const [status, setStatus] = useState<DependencyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ name: string; percentage: number } | null>(null)

  useEffect(() => {
    console.log('DependencyProvider mounted. Requesting dependency initialization...')
    // Request initialization from main process
    window.api.initializeDependencies() // No await needed, fire-and-forget request

    // Setup listeners
    const removeProgressListener = window.api.onDependencyProgress((progressData) => {
      console.log('Received dependency progress:', progressData)
      setProgress(progressData)
      setError(null) // Clear error on progress
    })

    const removeCompleteListener = window.api.onDependencySetupComplete((finalStatus) => {
      console.log('Dependency setup complete:', finalStatus)
      setStatus(finalStatus)
      // Determine overall readiness (currently only based on 7zip)
      setIsReady(finalStatus.sevenZip.ready)
      setError(
        finalStatus.sevenZip.ready
          ? null
          : finalStatus.sevenZip.error || '7zip failed without specific error'
      )
      setProgress(null) // Clear progress
    })

    const removeErrorListener = window.api.onDependencySetupError((errorInfo) => {
      console.error('Dependency setup error:', errorInfo)
      setStatus(errorInfo.status) // Store status even on error
      setIsReady(false)
      setError(errorInfo.message || 'Unknown dependency setup error')
      setProgress(null) // Clear progress
    })

    return () => {
      console.log('DependencyProvider unmounting, removing listeners.')
      removeProgressListener()
      removeCompleteListener()
      removeErrorListener()
    }
  }, []) // Run only once on mount

  const value: DependencyContextType = {
    isReady,
    status,
    error,
    progress
  }

  return <DependencyContext.Provider value={value}>{children}</DependencyContext.Provider>
}
