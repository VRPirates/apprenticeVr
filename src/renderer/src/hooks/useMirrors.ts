import { useState, useEffect, useCallback } from 'react'
import { Mirror, MirrorTestResult } from '@shared/types'

interface UseMirrorsReturn {
  mirrors: Mirror[]
  activeMirror: Mirror | null
  isLoading: boolean
  error: string | null
  testingMirrors: Set<string>
  addMirror: (configContent: string) => Promise<boolean>
  removeMirror: (id: string) => Promise<boolean>
  setActiveMirror: (id: string) => Promise<boolean>
  clearActiveMirror: () => Promise<boolean>
  testMirror: (id: string) => Promise<MirrorTestResult | null>
  testAllMirrors: () => Promise<MirrorTestResult[]>
  importMirrorFromFile: () => Promise<boolean>
  clearError: () => void
}

export const useMirrors = (): UseMirrorsReturn => {
  const [mirrors, setMirrors] = useState<Mirror[]>([])
  const [activeMirror, setActiveMirror] = useState<Mirror | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [testingMirrors, setTestingMirrors] = useState<Set<string>>(new Set())

  // Load mirrors on mount
  useEffect(() => {
    const loadMirrors = async (): Promise<void> => {
      try {
        setIsLoading(true)
        const [mirrorsData, activeMirrorData] = await Promise.all([
          window.api.mirrors.getMirrors(),
          window.api.mirrors.getActiveMirror()
        ])
        setMirrors(mirrorsData)
        setActiveMirror(activeMirrorData)
      } catch (err) {
        console.error('Error loading mirrors:', err)
        setError('Failed to load mirrors')
      } finally {
        setIsLoading(false)
      }
    }

    loadMirrors()
  }, [])

  // Listen for mirror updates
  useEffect(() => {
    const unsubscribe = window.api.mirrors.onMirrorsUpdated((updatedMirrors) => {
      setMirrors(updatedMirrors)
      // Update active mirror if it's in the list
      const currentActive = updatedMirrors.find((m) => m.isActive)
      setActiveMirror(currentActive || null)
    })

    return unsubscribe
  }, [])

  // Listen for test progress
  useEffect(() => {
    const unsubscribe = window.api.mirrors.onMirrorTestProgress((id, status, error) => {
      setTestingMirrors((prev) => {
        const newSet = new Set(prev)
        if (status === 'testing') {
          newSet.add(id)
        } else {
          newSet.delete(id)
        }
        return newSet
      })

      // Update mirror status in the list
      setMirrors((prev) =>
        prev.map((mirror) => {
          if (mirror.id === id) {
            return {
              ...mirror,
              testStatus: status,
              testError: error,
              lastTested: status !== 'testing' ? new Date() : mirror.lastTested
            }
          }
          return mirror
        })
      )
    })

    return unsubscribe
  }, [])

  const addMirror = useCallback(async (configContent: string): Promise<boolean> => {
    try {
      setError(null)
      const success = await window.api.mirrors.addMirror(configContent)
      if (!success) {
        setError('Failed to add mirror. Please check the configuration file.')
      }
      return success
    } catch (err) {
      console.error('Error adding mirror:', err)
      setError('Failed to add mirror')
      return false
    }
  }, [])

  const removeMirror = useCallback(async (id: string): Promise<boolean> => {
    try {
      setError(null)
      const success = await window.api.mirrors.removeMirror(id)
      if (!success) {
        setError('Failed to remove mirror')
      }
      return success
    } catch (err) {
      console.error('Error removing mirror:', err)
      setError('Failed to remove mirror')
      return false
    }
  }, [])

  const setActiveMirrorById = useCallback(async (id: string): Promise<boolean> => {
    try {
      setError(null)
      const success = await window.api.mirrors.setActiveMirror(id)

      return success
    } catch (err) {
      console.error('Error setting active mirror:', err)
      setError('Failed to set active mirror')
      return false
    }
  }, [])

  const testMirror = useCallback(async (id: string): Promise<MirrorTestResult | null> => {
    try {
      setError(null)
      const result = await window.api.mirrors.testMirror(id)
      return result
    } catch (err) {
      console.error('Error testing mirror:', err)
      setError('Failed to test mirror')
      return null
    }
  }, [])

  const testAllMirrors = useCallback(async (): Promise<MirrorTestResult[]> => {
    try {
      setError(null)
      const results = await window.api.mirrors.testAllMirrors()
      return results
    } catch (err) {
      console.error('Error testing all mirrors:', err)
      setError('Failed to test mirrors')
      return []
    }
  }, [])

  const importMirrorFromFile = useCallback(async (): Promise<boolean> => {
    try {
      setError(null)

      // Use the new streamlined import that picks and reads file in one operation
      const configContent = await window.api.mirrors.importFromFile()

      if (!configContent) {
        return false // User cancelled or failed to read file
      }

      // Add the mirror using the config content
      const success = await addMirror(configContent)
      return success
    } catch (err) {
      console.error('Error importing mirror:', err)
      setError('Failed to import mirror file')
      return false
    }
  }, [addMirror])

  const clearActiveMirror = useCallback(async (): Promise<boolean> => {
    try {
      setError(null)
      const success = await window.api.mirrors.clearActiveMirror()

      return success
    } catch (err) {
      console.error('Error clearing active mirror:', err)
      setError('Failed to clear active mirror')
      return false
    }
  }, [])

  return {
    mirrors,
    activeMirror,
    isLoading,
    error,
    testingMirrors,
    addMirror,
    removeMirror,
    setActiveMirror: setActiveMirrorById,
    clearActiveMirror,
    testMirror,
    testAllMirrors,
    importMirrorFromFile,
    clearError: () => setError(null)
  }
}
