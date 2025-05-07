import React, { ReactNode, useEffect, useState, useCallback, useMemo } from 'react'
import { GameInfo } from '../types/adb'
import { GamesContext, GamesContextType } from './GamesContext'
import { useAdb } from '../hooks/useAdb'
import { useDependency } from '../hooks/useDependency'

interface GamesProviderProps {
  children: ReactNode
}

// Helper function to parse version string (extract numbers)
const parseVersion = (versionString: string): number | null => {
  if (!versionString) return null
  const match = versionString.match(/\d+/g) // Find all sequences of digits
  if (!match) return null
  // Join digits and parse as integer (handles versions like "1.2.3" -> 123)
  try {
    return parseInt(match.join(''), 10)
  } catch (e) {
    console.warn(`Failed to parse version string: ${versionString}`, e)
    return null
  }
}

export const GamesProvider: React.FC<GamesProviderProps> = ({ children }) => {
  const [rawGames, setRawGames] = useState<GameInfo[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [extractProgress, setExtractProgress] = useState<number>(0)
  const [deviceVersionCodes, setDeviceVersionCodes] = useState<{ [packageName: string]: number }>(
    {}
  )
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState<boolean>(false)

  const { packages: installedPackages, isConnected: isDeviceConnected, selectedDevice } = useAdb()
  const dependencyContext = useDependency()

  const fetchDeviceVersionCodes = useCallback(async () => {
    if (!isDeviceConnected || !selectedDevice || installedPackages.length === 0) {
      setDeviceVersionCodes({})
      return
    }

    const versions: { [packageName: string]: number } = {}
    const installedGamePackages = rawGames
      .filter(
        (game) =>
          game.packageName && installedPackages.some((p) => p.packageName === game.packageName)
      )
      .map((game) => game.packageName)

    console.log(`Checking versions for ${installedGamePackages.length} installed packages...`)

    const results = await Promise.allSettled(
      installedGamePackages.map(async (pkgName) => {
        try {
          const versionCode = await window.api.adb.getPackageVersionCode(selectedDevice!, pkgName)
          if (versionCode !== null) {
            return { packageName: pkgName, versionCode }
          }
        } catch (err) {
          console.error(`Error fetching version code for ${pkgName}:`, err)
        }
        return null
      })
    )

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        versions[result.value.packageName] = result.value.versionCode
      }
    })

    console.log('Fetched device versions:', versions)
    setDeviceVersionCodes(versions)
  }, [isDeviceConnected, selectedDevice, installedPackages, rawGames])

  useEffect(() => {
    if (isDeviceConnected) {
      fetchDeviceVersionCodes()
    }
  }, [fetchDeviceVersionCodes, isDeviceConnected])

  const games = useMemo((): GameInfo[] => {
    const installedSet = new Set(installedPackages.map((pkg) => pkg.packageName))

    return rawGames.map((game) => {
      const isInstalled = game.packageName ? installedSet.has(game.packageName) : false
      let deviceVersionCode: number | undefined = undefined
      let hasUpdate = false

      if (isInstalled && game.packageName && deviceVersionCodes[game.packageName] !== undefined) {
        deviceVersionCode = deviceVersionCodes[game.packageName]
        const listVersionNumeric = parseVersion(game.version)
        const deviceVersionNumeric = deviceVersionCode // Already a number

        if (listVersionNumeric !== null && deviceVersionNumeric !== null) {
          hasUpdate = listVersionNumeric > deviceVersionNumeric
        }
      }

      return {
        ...game,
        isInstalled,
        deviceVersionCode,
        hasUpdate
      }
    })
  }, [rawGames, installedPackages, deviceVersionCodes])

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
      if (!isInitialLoadComplete) {
        setIsInitialLoadComplete(true)
      }
    }
  }, [isInitialLoadComplete])

  const refreshGames = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)
      setDownloadProgress(0)
      setExtractProgress(0)
      setDeviceVersionCodes({})

      const gamesList = await window.api.games.forceSync()
      const syncTime = await window.api.games.getLastSyncTime()

      setRawGames(gamesList)
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
    const initializeAndLoad = async (): Promise<void> => {
      if (dependencyContext.isReady && !isInitialLoadComplete) {
        console.log('Dependencies ready, initializing game service and loading games...')
        try {
          setIsLoading(true)
          await window.api.initializeGameService()
          await loadGames()
        } catch (initError) {
          console.error('Failed to initialize game service or load games:', initError)
          setError(initError instanceof Error ? initError.message : 'Failed to load game data')
          setIsInitialLoadComplete(true)
        }
      }
    }
    initializeAndLoad()
  }, [dependencyContext.isReady, loadGames, isInitialLoadComplete])

  const getNote = useCallback(async (releaseName: string): Promise<string> => {
    return await window.api.games.getNote(releaseName)
  }, [])

  const value: GamesContextType = {
    games,
    isLoading,
    error,
    lastSyncTime,
    downloadProgress,
    extractProgress,
    refreshGames,
    loadGames,
    getNote,
    isInitialLoadComplete
  }

  return <GamesContext.Provider value={value}>{children}</GamesContext.Provider>
}
