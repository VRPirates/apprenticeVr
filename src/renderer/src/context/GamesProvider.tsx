import React, { ReactNode, useEffect, useState, useCallback, useMemo } from 'react'
import { GameInfo, MissingGame, OutdatedGame, UploadCandidate } from '@shared/types'
import { GamesContext } from './GamesContext'
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
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState<boolean>(false)
  const [outdatedGames, setOutdatedGames] = useState<OutdatedGame[]>([])
  const [missingGames, setMissingGames] = useState<MissingGame[]>([])
  const [uploadCandidates, setUploadCandidates] = useState<UploadCandidate[]>([])

  const { packages: installedPackages, isConnected: isDeviceConnected } = useAdb()
  const dependencyContext = useDependency()

  // Check for installed games that are missing from the database or newer than outdated games
  const checkForUploadCandidates = useCallback(() => {
    if (!isDeviceConnected || installedPackages.length === 0) {
      return
    }

    const candidates: UploadCandidate[] = []

    // Check for missing games
    const allGamePackages = new Set(rawGames.map((game) => game.packageName))

    // Process installed packages that are missing from our game list
    const processMissingPackages = async (): Promise<void> => {
      for (const pkg of installedPackages) {
        if (
          !allGamePackages.has(pkg.packageName) &&
          // Filter out obvious system packages and common apps
          // !pkg.packageName.startsWith('com.android.') &&
          // !pkg.packageName.startsWith('com.google.') &&
          // !pkg.packageName.startsWith('com.oculus.') &&
          // !pkg.packageName.startsWith('com.meta.') &&
          // !pkg.packageName.includes('launcher') &&

          // Check if this package is in our missing games list
          missingGames.some((g) => g.packageName === pkg.packageName)
        ) {
          candidates.push({
            packageName: pkg.packageName,
            gameName:
              missingGames.find((g) => g.packageName === pkg.packageName)?.gameName ||
              pkg.packageName,
            versionCode: pkg.versionCode,
            reason: 'missing'
          })
        }
      }

      // Check for outdated games where we have newer versions installed
      for (const outdatedGame of outdatedGames) {
        if (installedPackages.find((pkg) => pkg.packageName === outdatedGame.packageName)) {
          const storeVersion = parseInt(outdatedGame.latestVersionCode, 10)
          const deviceVersion = installedPackages.find(
            (pkg) => pkg.packageName === outdatedGame.packageName
          )?.versionCode

          if (!isNaN(storeVersion) && deviceVersion && deviceVersion > storeVersion) {
            candidates.push({
              packageName: outdatedGame.packageName,
              gameName: outdatedGame.gameName,
              versionCode: deviceVersion,
              reason: 'newer',
              storeVersion: outdatedGame.versionName || outdatedGame.latestVersionCode
            })
          }
        }
      }

      if (candidates.length > 0) {
        console.log('Found upload candidates:', candidates)
        setUploadCandidates(candidates)
      }
    }

    processMissingPackages()
  }, [isDeviceConnected, installedPackages, rawGames, missingGames, outdatedGames])

  // Check for upload candidates whenever device version codes or missing/outdated games change
  useEffect(() => {
    if (missingGames.length > 0 || outdatedGames.length > 0) {
      checkForUploadCandidates()
    }
  }, [installedPackages, missingGames, outdatedGames, checkForUploadCandidates])

  // enrich the games with the installed packages and the device version codes
  const games = useMemo((): GameInfo[] => {
    const installedSet = new Set(installedPackages.map((pkg) => pkg.packageName))

    return rawGames.map((game) => {
      const isInstalled = game.packageName ? installedSet.has(game.packageName) : false
      let deviceVersionCode: number | undefined = undefined
      let hasUpdate = false

      if (
        isInstalled &&
        game.packageName &&
        installedPackages.find((pkg) => pkg.packageName === game.packageName)
      ) {
        deviceVersionCode = installedPackages.find(
          (pkg) => pkg.packageName === game.packageName
        )?.versionCode
        const listVersionNumeric = parseVersion(game.version)

        if (listVersionNumeric !== null && deviceVersionCode !== undefined) {
          hasUpdate = listVersionNumeric > deviceVersionCode
        }
      }

      return {
        ...game,
        isInstalled,
        deviceVersionCode,
        hasUpdate
      }
    })
  }, [rawGames, installedPackages])

  const localGames = useMemo((): GameInfo[] => {
    return installedPackages.map((game) => ({
      id: game.packageName,
      packageName: game.packageName,
      name: game.packageName,
      version: String(game.versionCode),
      size: '0',
      lastUpdated: new Date().toISOString(),
      releaseName: game.packageName,
      downloads: 0,
      downloadsUpdated: new Date().toISOString(),
      isInstalled: true,
      thumbnailPath: '',
      notePath: ''
    }))
  }, [installedPackages])

  const loadGames = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      const gamesList = await window.api.games.getGames()
      setRawGames(gamesList)

      const syncTime = await window.api.games.getLastSyncTime()
      setLastSyncTime(syncTime ? new Date(syncTime) : null)

      // Fetch missing and outdated games
      // @ts-ignore: Method exists in implementation but not in type definitions
      const missingGamesList = await window.api.games.getMissingGames()
      // @ts-ignore: Method exists in implementation but not in type definitions
      const outdatedGamesList = await window.api.games.getOutdatedGames()
      setMissingGames(missingGamesList)
      setOutdatedGames(outdatedGamesList)
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

      const gamesList = await window.api.games.forceSync()
      const syncTime = await window.api.games.getLastSyncTime()

      setRawGames(gamesList)
      setLastSyncTime(syncTime ? new Date(syncTime) : null)

      // Refresh missing and outdated games
      // @ts-ignore: Method exists in implementation but not in type definitions
      const missingGamesList = await window.api.games.getMissingGames()
      // @ts-ignore: Method exists in implementation but not in type definitions
      const outdatedGamesList = await window.api.games.getOutdatedGames()
      setMissingGames(missingGamesList)
      setOutdatedGames(outdatedGamesList)
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
          //await window.api.initializeGameService()
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

  const value = {
    games,
    localGames,
    isLoading,
    error,
    lastSyncTime,
    downloadProgress,
    extractProgress,
    refreshGames,
    loadGames,
    getNote,
    isInitialLoadComplete,
    outdatedGames,
    missingGames,
    uploadCandidates
  }

  return <GamesContext.Provider value={value}>{children}</GamesContext.Provider>
}
