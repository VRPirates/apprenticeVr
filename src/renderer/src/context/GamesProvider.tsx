import React, { ReactNode, useEffect, useState, useCallback, useMemo } from 'react'
import { GameInfo } from '../types/adb'
import { GamesContext } from './GamesContext'
import { useAdb } from '../hooks/useAdb'

interface GamesProviderProps {
  children: ReactNode
}

// Helper function to parse version string (extract numbers)
const parseVersion = (versionString: string): number | null => {
  if (!versionString) return null
  const match = versionString.match(/\d+/g) // Find all sequences of digits
  if (!match) return null
  // Join digits and parse as integer (handles versions like "1.2.3" -> 123)
  // Adjust this logic if version comparison needs to be more sophisticated
  try {
    return parseInt(match.join(''), 10)
  } catch (e) {
    console.warn(`Failed to parse version string: ${versionString}`, e)
    return null
  }
}

export const GamesProvider: React.FC<GamesProviderProps> = ({ children }) => {
  const [rawGames, setRawGames] = useState<GameInfo[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [extractProgress, setExtractProgress] = useState<number>(0)
  const [deviceVersionCodes, setDeviceVersionCodes] = useState<{ [packageName: string]: number }>(
    {}
  )
  const [isCheckingVersions, setIsCheckingVersions] = useState<boolean>(false)

  const { packages: installedPackages, isConnected: isDeviceConnected, selectedDevice } = useAdb()

  // Fetch version codes for installed packages on the connected device
  const fetchDeviceVersionCodes = useCallback(async () => {
    if (!isDeviceConnected || !selectedDevice || installedPackages.length === 0) {
      setDeviceVersionCodes({})
      return
    }

    setIsCheckingVersions(true)
    const versions: { [packageName: string]: number } = {}
    const installedGamePackages = rawGames
      .filter(
        (game) =>
          game.packageName && installedPackages.some((p) => p.packageName === game.packageName)
      )
      .map((game) => game.packageName)

    console.log(`Checking versions for ${installedGamePackages.length} installed packages...`)

    // Use Promise.allSettled to fetch all versions concurrently
    const results = await Promise.allSettled(
      installedGamePackages.map(async (pkgName) => {
        try {
          const versionCode = await window.api.adb.getPackageVersionCode(selectedDevice, pkgName)
          if (versionCode !== null) {
            return { packageName: pkgName, versionCode }
          }
        } catch (err) {
          console.error(`Error fetching version code for ${pkgName}:`, err)
        }
        return null // Indicate failure or no version code found
      })
    )

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        versions[result.value.packageName] = result.value.versionCode
      }
    })

    console.log('Fetched device versions:', versions)
    setDeviceVersionCodes(versions)
    setIsCheckingVersions(false)
  }, [isDeviceConnected, selectedDevice, installedPackages, rawGames])

  // Trigger version fetching when connection status or installed packages change
  useEffect(() => {
    if (isDeviceConnected) {
      fetchDeviceVersionCodes()
    }
  }, [fetchDeviceVersionCodes, isDeviceConnected]) // Rerun when fetch function identity changes (deps change)

  // Enrich games with installed status AND update status
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

  // Original loadGames and refreshGames remain largely the same,
  // but refresh might implicitly trigger version re-check via useEffect
  const loadGames = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      const gamesList = await window.api.games.getGames()
      setRawGames(gamesList)

      const syncTime = await window.api.games.getLastSyncTime()
      setLastSyncTime(syncTime ? new Date(syncTime) : null)
      // Reset device versions when reloading game list? Maybe not necessary.
      // setDeviceVersionCodes({});
    } catch (err) {
      console.error('Error loading games:', err)
      setError('Failed to load games')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshGames = useCallback(async (): Promise<void> => {
    // ... (keep existing implementation)
    try {
      setIsLoading(true)
      setError(null)
      setDownloadProgress(0)
      setExtractProgress(0)
      // Resetting versions might be good here before fetching new list
      setDeviceVersionCodes({})

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
      // Version check will trigger via useEffect if device is still connected
    }
  }, [])

  useEffect(() => {
    // ... (keep progress listener setup)
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

  const getNote = useCallback(async (releaseName: string): Promise<string> => {
    return await window.api.games.getNote(releaseName)
  }, [])

  const value = {
    games, // This now includes isInstalled, deviceVersionCode, hasUpdate
    isLoading: isLoading || isCheckingVersions, // Combine loading states
    error,
    lastSyncTime,
    downloadProgress,
    extractProgress,
    refreshGames,
    getNote
    // No need to expose deviceVersionCodes or isCheckingVersions directly
  }

  return <GamesContext.Provider value={value}>{children}</GamesContext.Provider>
}
