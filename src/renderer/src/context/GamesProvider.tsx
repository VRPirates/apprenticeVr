import React, { ReactNode, useEffect, useState, useCallback, useMemo } from 'react'
import { GameInfo } from '../types/adb'
import { GamesContext } from './GamesContext'
import { useAdb } from '../hooks/useAdb'

interface GamesProviderProps {
  children: ReactNode
}

export const GamesProvider: React.FC<GamesProviderProps> = ({ children }) => {
  const [rawGames, setRawGames] = useState<GameInfo[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [extractProgress, setExtractProgress] = useState<number>(0)

  const { packages: installedPackages, isConnected: isDeviceConnected } = useAdb()

  const enrichGamesWithStatus = useCallback(
    (gamesToEnrich: GameInfo[]): GameInfo[] => {
      if (!isDeviceConnected) {
        return gamesToEnrich.map((game) => ({ ...game, isInstalled: false }))
      }
      const installedSet = new Set(installedPackages.map((pkg) => pkg.packageName))
      return gamesToEnrich.map((game) => ({
        ...game,
        isInstalled: game.packageName ? installedSet.has(game.packageName) : false
      }))
    },
    [installedPackages, isDeviceConnected]
  )

  const games = useMemo(() => enrichGamesWithStatus(rawGames), [rawGames, enrichGamesWithStatus])

  const loadGames = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      const gamesList = await window.api.games.getGames()
      setRawGames(gamesList)

      const syncTime = await window.api.games.getLastSyncTime()
      setLastSyncTime(syncTime ? new Date(syncTime) : null)
    } catch (err) {
      console.error('Error loading games:', err)
      setError('Failed to load games')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshGames = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)
      setDownloadProgress(0)
      setExtractProgress(0)

      const gamesList = await window.api.games.forceSync()
      setRawGames(gamesList)

      const syncTime = await window.api.games.getLastSyncTime()
      setLastSyncTime(syncTime ? new Date(syncTime) : null)
    } catch (err) {
      console.error('Error refreshing games:', err)
      setError('Failed to refresh games')
    } finally {
      setIsLoading(false)
      setDownloadProgress(0)
      setExtractProgress(0)
    }
  }, [])

  useEffect(() => {
    const removeDownloadProgressListener = window.api.games.onDownloadProgress((progress) => {
      if (progress.type === 'meta') {
        setDownloadProgress(progress.progress)
      }
    })

    const removeExtractProgressListener = window.api.games.onExtractProgress((progress) => {
      if (progress.type === 'meta') {
        setExtractProgress(progress.progress)
      }
    })

    return () => {
      removeDownloadProgressListener()
      removeExtractProgressListener()
    }
  }, [])

  useEffect(() => {
    loadGames()
  }, [loadGames])

  const value = {
    games,
    isLoading,
    error,
    lastSyncTime,
    downloadProgress,
    extractProgress,
    refreshGames
  }

  return <GamesContext.Provider value={value}>{children}</GamesContext.Provider>
}
