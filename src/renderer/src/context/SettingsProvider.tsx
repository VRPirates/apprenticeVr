import React, { ReactNode, useEffect, useState, useCallback } from 'react'
import { SettingsContext, SettingsContextType } from './SettingsContext'

interface SettingsProviderProps {
  children: ReactNode
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const [downloadPath, setDownloadPathState] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Load initial settings when component mounts
  useEffect(() => {
    let isMounted = true

    window.api.settings
      .getDownloadPath()
      .then((path) => {
        if (isMounted) {
          console.log('Fetched initial download path:', path)
          setDownloadPathState(path)
        }
      })
      .catch((err) => {
        console.error('Error fetching download path:', err)
        if (isMounted) {
          setError('Failed to load settings')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  // Function to update download path
  const setDownloadPath = useCallback(async (path: string): Promise<void> => {
    try {
      setIsLoading(true)
      await window.api.settings.setDownloadPath(path)
      setDownloadPathState(path)
      setError(null)
    } catch (err) {
      console.error('Error setting download path:', err)
      setError('Failed to update download path')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  const value: SettingsContextType = {
    downloadPath,
    isLoading,
    error,
    setDownloadPath
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
