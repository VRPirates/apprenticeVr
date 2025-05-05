import React, { ReactNode, useEffect, useState, useCallback } from 'react'
import { DownloadContext, DownloadContextType } from './DownloadContext'
import { DownloadItem, GameInfo } from '../types/adb'

interface DownloadProviderProps {
  children: ReactNode
}

export const DownloadProvider: React.FC<DownloadProviderProps> = ({ children }) => {
  const [queue, setQueue] = useState<DownloadItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true) // Start loading initially
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    setIsLoading(true)

    // Fetch initial queue
    window.api.downloads
      .getQueue()
      .then((initialQueue) => {
        if (isMounted) {
          console.log('Fetched initial download queue:', initialQueue)
          setQueue(initialQueue)
        }
      })
      .catch((err) => {
        console.error('Error fetching initial download queue:', err)
        if (isMounted) {
          setError('Failed to load download queue')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    // Setup listener for updates
    const removeUpdateListener = window.api.downloads.onQueueUpdated((updatedQueue) => {
      // console.log('Received download queue update:', updatedQueue) // Debug log
      console.log('[DownloadProvider] Received queue update:', JSON.stringify(updatedQueue))
      setQueue(updatedQueue)
      // Clear error on update, assuming update means things are working
      setError(null)
      // Might want to set isLoading based on whether anything is Downloading?
      // setIsLoading(updatedQueue.some(item => item.status === 'Downloading'));
    })

    return () => {
      isMounted = false
      removeUpdateListener()
    }
  }, []) // Run only once on mount

  const addToQueue = useCallback(async (game: GameInfo): Promise<boolean> => {
    console.log(`Context: Adding ${game.releaseName} to queue...`)
    try {
      const success = await window.api.downloads.add(game)
      if (!success) {
        console.warn(
          `Context: Failed to add ${game.releaseName} to queue (likely already present).`
        )
      }
      return success
    } catch (err) {
      console.error('Error adding game to download queue via IPC:', err)
      setError(`Failed to add ${game.name} to queue.`)
      return false
    }
  }, [])

  const removeFromQueue = useCallback((releaseName: string): void => {
    console.log(`Context: Removing ${releaseName} from queue...`)
    // Optimistic update? Maybe not necessary as main process handles it
    // setQueue(prev => prev.filter(item => item.releaseName !== releaseName));
    try {
      window.api.downloads.remove(releaseName)
    } catch (err) {
      console.error('Error removing game from download queue via IPC:', err)
      setError(`Failed to remove item from queue.`)
      // May need to refetch queue here if optimistic update was used
    }
  }, [])

  // Renamed from pauseDownload
  const cancelDownload = useCallback((releaseName: string): void => {
    console.log(`Context: Cancelling ${releaseName}...`)
    try {
      window.api.downloads.cancel(releaseName) // Use new cancel API
    } catch (err) {
      console.error('Error cancelling download via IPC:', err)
      setError(`Failed to cancel download.`)
    }
  }, [])

  // Renamed from resumeDownload
  const retryDownload = useCallback((releaseName: string): void => {
    console.log(`Context: Retrying ${releaseName}...`)
    try {
      window.api.downloads.retry(releaseName) // Use new retry API
    } catch (err) {
      console.error('Error retrying download via IPC:', err)
      setError(`Failed to retry download.`)
    }
  }, [])

  const value: DownloadContextType = {
    queue,
    isLoading,
    error,
    addToQueue,
    removeFromQueue,
    cancelDownload, // Pass new cancel function
    retryDownload // Pass new retry function
  }

  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>
}
