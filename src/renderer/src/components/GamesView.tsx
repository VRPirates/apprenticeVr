import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
  SortingState,
  FilterFn,
  ColumnFiltersState,
  Row
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAdb } from '../hooks/useAdb'
import { useGames } from '../hooks/useGames'
import { useDownload } from '../hooks/useDownload'
import { GameInfo } from '../types/adb' // Make sure GameInfo is imported
import placeholderImage from '../assets/images/game-placeholder.png'
// Import Dialog components
import {
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogActions,
  Button, // Keep Button import
  DialogContent,
  tokens,
  shorthands,
  makeStyles,
  Title2,
  Text,
  Input,
  Image,
  Badge,
  Divider,
  ProgressBar,
  Spinner // Import Spinner
} from '@fluentui/react-components'
import {
  ArrowClockwiseRegular,
  DismissRegular,
  PlugDisconnectedRegular,
  DocumentDataRegular,
  CalendarClockRegular,
  ArrowDownloadRegular as DownloadIcon,
  TagRegular,
  DeleteRegular,
  ArrowSyncRegular,
  ArrowUpRegular,
  InfoRegular,
  CheckmarkCircleRegular
} from '@fluentui/react-icons'
import { ArrowLeftRegular } from '@fluentui/react-icons'

interface GamesViewProps {
  onBackToDevices: () => void
}

// Define the expanded filter type
type FilterType = 'all' | 'installed' | 'update'

// Filter function specifically for game name AND package name
const filterGameNameAndPackage: FilterFn<GameInfo> = (row, _columnId, filterValue) => {
  const searchStr = String(filterValue).toLowerCase()
  const gameName = String(row.original.name ?? '').toLowerCase()
  const packageName = String(row.original.packageName ?? '').toLowerCase()

  // Simple check if search string is in name or package name
  return gameName.includes(searchStr) || packageName.includes(searchStr)
  // Or use matchSorter on combined data if preferred
  // return matchSorter([`${gameName} ${packageName}`], searchStr).length > 0;
}

// Extend the FilterFns interface
declare module '@tanstack/react-table' {
  interface FilterFns {
    gameNameAndPackageFilter: FilterFn<GameInfo>
  }
  // ... FilterMeta if needed ...
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...shorthands.padding(tokens.spacingVerticalL, tokens.spacingHorizontalL),
    ...shorthands.borderBottom(tokens.strokeWidthThin, 'solid', tokens.colorNeutralStroke1),
    backgroundColor: tokens.colorNeutralBackground3,
    flexShrink: 0
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM
  },
  deviceInfoBar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS
  },
  connectedDeviceText: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS
  },
  deviceWarningText: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorPaletteRedForeground1
  },
  tableContainer: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.padding(tokens.spacingVerticalL, tokens.spacingHorizontalL),
    overflow: 'hidden'
  },
  toolbar: {
    // Rely on Fluent UI Toolbar component for styling
    marginBottom: tokens.spacingVerticalL,
    flexShrink: 0
  },
  filterButtons: {
    display: 'flex',
    gap: tokens.spacingHorizontalS
  },
  toolbarRight: {
    // Style the right group in toolbar
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM
  },
  searchInput: {
    width: '250px'
  },
  statusArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    ...shorthands.padding(tokens.spacingVerticalXXL),
    flexGrow: 1
  },
  progressBarContainer: {
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    alignItems: 'center'
  },
  tableWrapper: {
    flexGrow: 1,
    overflow: 'auto', // Scroll for table content
    position: 'relative' // Needed for virtualizer
  },
  dialogContentLayout: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    marginTop: tokens.spacingVerticalL
  },
  deleteConfirmText: {
    ...shorthands.padding(tokens.spacingVerticalM, 0)
  },
  namePackageCellContainer: {
    position: 'relative',
    paddingBottom: '8px', // Add padding to prevent overlap with progress bar
    height: '100%', // Ensure container fills cell height
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center' // Vertically center the text
  },
  namePackageCellText: {
    // Styles specific to the text part if needed
  },
  progressBarAcrossRow: {
    position: 'absolute',
    bottom: '0',
    left: '0',
    right: '0',
    height: '4px'
    // Consider adding a small z-index if needed
  },
  statusIconCell: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%'
  },
  resizer: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: '100%',
    width: '5px',
    background: 'rgba(0, 0, 0, 0.1)',
    cursor: 'col-resize',
    userSelect: 'none',
    touchAction: 'none',
    opacity: 0,
    transition: 'opacity 0.2s ease-in-out',
    ':hover': {
      opacity: 1
    }
  },
  isResizing: {
    background: tokens.colorBrandBackground,
    opacity: 1
  }
})

const GamesView: React.FC<GamesViewProps> = ({ onBackToDevices }) => {
  const {
    selectedDevice,
    isConnected,
    disconnectDevice,
    isLoading: adbLoading,
    loadPackages
  } = useAdb()
  const {
    games,
    isLoading: loadingGames,
    error: gamesError,
    lastSyncTime,
    downloadProgress,
    extractProgress,
    refreshGames,
    getNote
  } = useGames()
  const {
    addToQueue: addDownloadToQueue,
    queue: downloadQueue,
    cancelDownload,
    retryDownload,
    deleteFiles
  } = useDownload()

  const styles = useStyles()

  const [globalFilter, setGlobalFilter] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [dialogGame, setDialogGame] = useState<GameInfo | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState<boolean>(false)
  const [currentGameNote, setCurrentGameNote] = useState<string | null>(null)
  const [loadingNote, setLoadingNote] = useState<boolean>(false)
  const tableContainerRef = useRef<HTMLDivElement>(null)

  // Calculate counts based on the full games list
  const counts = useMemo(() => {
    const total = games.length
    const installed = games.filter((g) => g.isInstalled).length
    const updates = games.filter((g) => g.hasUpdate).length
    return { total, installed, updates }
  }, [games])

  // Update column filter when activeFilter state changes
  useEffect(() => {
    setColumnFilters((prev) => {
      // Remove existing isInstalled and hasUpdate filters first
      const otherFilters = prev.filter((f) => f.id !== 'isInstalled' && f.id !== 'hasUpdate')

      switch (activeFilter) {
        case 'installed':
          return [...otherFilters, { id: 'isInstalled', value: true }]
        case 'update':
          // Ensure the game is also considered 'installed' when filtering for updates
          return [
            ...otherFilters,
            { id: 'isInstalled', value: true },
            { id: 'hasUpdate', value: true }
          ]
        case 'all':
        default:
          return otherFilters
      }
    })
  }, [activeFilter])

  // Fetch note when dialog opens
  useEffect(() => {
    let isMounted = true // Prevent state update on unmounted component

    if (isDialogOpen && dialogGame && dialogGame.releaseName) {
      const fetchNote = async (): Promise<void> => {
        setLoadingNote(true)
        setCurrentGameNote(null) // Clear previous note
        try {
          const note = await getNote(dialogGame.releaseName)
          if (isMounted) {
            setCurrentGameNote(note)
          }
        } catch (err) {
          console.error(`Error fetching note for \${dialogGame.releaseName}:`, err)
          if (isMounted) {
            setCurrentGameNote('Error loading note.') // Show error in dialog
          }
        } finally {
          if (isMounted) {
            setLoadingNote(false)
          }
        }
      }
      fetchNote()
    }
    return () => {
      isMounted = false
    }
  }, [isDialogOpen, dialogGame, getNote])

  // Effect to refresh installed packages when installation completes
  useEffect(() => {
    const unsubscribe = window.api.adb.onInstallationCompleted((deviceId) => {
      console.log(`[GamesView] Received installation-completed event for device: ${deviceId}`)
      if (selectedDevice && deviceId === selectedDevice) {
        console.log(`[GamesView] Refreshing packages for current device ${selectedDevice}...`)
        loadPackages()
          .then(() => console.log('[GamesView] Package refresh triggered successfully.'))
          .catch((err) => console.error('[GamesView] Error triggering package refresh:', err))
      } else {
        console.log(
          `[GamesView] Installation completed event for non-selected device (${deviceId}), ignoring.`
        )
      }
    })

    return () => {
      console.log('[GamesView] Cleaning up installation completed listener.')
      unsubscribe()
    }
  }, [selectedDevice, loadPackages]) // Depend on selectedDevice and loadPackages

  // --- Re-add Map for Download Status/Progress --- START
  const downloadStatusMap = useMemo(() => {
    const map = new Map<string, { status: string; progress: number }>()
    downloadQueue.forEach((item) => {
      if (item.releaseName) {
        const progress =
          item.status === 'Extracting' ? (item.extractProgress ?? 0) : (item.progress ?? 0)
        map.set(item.releaseName, {
          status: item.status,
          progress: progress
        })
      }
    })
    return map
  }, [downloadQueue])
  // --- Re-add Map for Download Status/Progress --- END

  // Columns definition updated
  const columns = useMemo<ColumnDef<GameInfo>[]>(
    () => [
      {
        id: 'downloadStatus',
        header: '',
        size: 40,
        enableResizing: false,
        enableSorting: false,
        cell: ({ row }) => {
          const game = row.original
          const downloadInfo = game.releaseName
            ? downloadStatusMap.get(game.releaseName)
            : undefined
          const isDownloadedNotInstalled = downloadInfo?.status === 'Completed' && !game.isInstalled

          return (
            <div className={styles.statusIconCell}>
              {isDownloadedNotInstalled && (
                <CheckmarkCircleRegular
                  fontSize={16}
                  color={tokens.colorPaletteGreenForeground1}
                  aria-label="Downloaded"
                />
              )}
            </div>
          )
        }
      },
      {
        accessorKey: 'thumbnailPath',
        header: ' ',
        size: 90,
        enableResizing: false,
        cell: ({ getValue }) => {
          const path = getValue<string>()
          return (
            <div className="game-thumbnail-cell">
              <img
                src={path ? `file://${path}` : placeholderImage}
                alt="Thumbnail"
                className="game-thumbnail-img"
              />
            </div>
          )
        },
        enableSorting: false
      },
      {
        accessorKey: 'name',
        header: 'Name / Package',
        size: 600,
        cell: ({ row }) => {
          const game = row.original
          const downloadInfo = game.releaseName
            ? downloadStatusMap.get(game.releaseName)
            : undefined
          const isDownloading = downloadInfo?.status === 'Downloading'
          const isExtracting = downloadInfo?.status === 'Extracting'
          const isQueued = downloadInfo?.status === 'Queued'
          const isInstalling = downloadInfo?.status === 'Installing' // Check for Installing
          const isInstallError = downloadInfo?.status === 'InstallError'

          return (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                height: '100%',
                position: 'relative',
                paddingBottom: '8px'
              }}
            >
              <div style={{ marginBottom: tokens.spacingVerticalXS }}>
                {' '}
                {/* Add some space below text */}
                <div className="game-name-main">{game.name}</div>
                <div className="game-package-sub">{game.packageName}</div>
              </div>
              {/* Status Indicator Area */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS }}
              >
                {isQueued && (
                  <Badge shape="rounded" color="informative" appearance="outline">
                    Queued
                  </Badge>
                )}
                {/* Add Installing Badge/Spinner */}
                {isInstalling && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: tokens.spacingHorizontalXS
                    }}
                  >
                    <Spinner size="tiny" aria-label="Installing" />
                    <Badge shape="rounded" color="brand" appearance="outline">
                      Installing
                    </Badge>
                  </div>
                )}
                {isInstallError && (
                  <Badge shape="rounded" color="danger" appearance="outline">
                    Install Error
                  </Badge>
                )}
                {/* Potential spinner icon if needed
                {isInstalling && <Spinner size="tiny" />} */}
              </div>

              {/* Progress Bar for Downloading/Extracting (hide if installing) */}
              {(isDownloading || isExtracting) && !isInstalling && downloadInfo && (
                <ProgressBar
                  value={downloadInfo.progress}
                  max={100}
                  shape="rounded"
                  thickness="medium"
                  className={styles.progressBarAcrossRow}
                  aria-label={isDownloading ? 'Download progress' : 'Extraction progress'}
                />
              )}
            </div>
          )
        },
        enableResizing: true
      },
      {
        accessorKey: 'version',
        header: 'Version',
        size: 180,
        cell: ({ row }) => {
          const listVersion = row.original.version
          const isInstalled = row.original.isInstalled
          const deviceVersion = row.original.deviceVersionCode
          // hasUpdate is used for row styling now, not text

          const displayListVersion = listVersion ? `v${listVersion}` : '-'

          return (
            <div className="version-cell">
              <div className="list-version-main">{displayListVersion}</div>
              {isInstalled && (
                <div className="installed-version-info">
                  {deviceVersion !== undefined ? `Installed: v${deviceVersion}` : 'Installed'}
                </div>
              )}
            </div>
          )
        },
        enableResizing: true
      },
      {
        accessorKey: 'size',
        header: 'Size',
        size: 90,
        cell: (info) => info.getValue() || '-',
        enableResizing: true
      },
      {
        accessorKey: 'lastUpdated',
        header: 'Last Updated',
        size: 180,
        cell: (info) => info.getValue() || '-',
        enableResizing: true
      },
      {
        accessorKey: 'isInstalled',
        header: 'Installed Status',
        enableResizing: false
      },
      {
        accessorKey: 'hasUpdate',
        header: 'Update Status',
        enableResizing: false
      }
    ],
    [downloadStatusMap, styles]
  )

  const table = useReactTable({
    data: games,
    columns,
    columnResizeMode: 'onChange',
    filterFns: {
      gameNameAndPackageFilter: filterGameNameAndPackage
    },
    state: {
      sorting,
      globalFilter,
      columnFilters,
      columnVisibility: { isInstalled: false, hasUpdate: false }
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: 'gameNameAndPackageFilter',
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel()
  })

  // Virtualizer setup
  const { rows } = table.getRowModel()
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 90, // Keep estimateSize
    overscan: 10
  })

  // Format date for display
  const formatDate = (date: Date | null): string => {
    if (!date) return 'Never'
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  // Determine the current process message
  const getProcessMessage = (): string => {
    if (downloadProgress > 0 && downloadProgress < 100) {
      return `Downloading game data... ${downloadProgress}%`
    } else if (extractProgress > 0 && extractProgress < 100) {
      return `Extracting game data... ${extractProgress}%`
    } else if (loadingGames) {
      return 'Preparing game library...'
    }
    return ''
  }

  // Calculate the current progress percentage
  const getCurrentProgress = (): number => {
    if (downloadProgress > 0 && downloadProgress < 100) {
      return downloadProgress
    } else if (extractProgress > 0 && extractProgress < 100) {
      return extractProgress
    }
    return 0
  }

  // Handle Row Click - Updated to open Dialog
  const handleRowClick = (
    _event: React.MouseEvent<HTMLTableRowElement>,
    row: Row<GameInfo>
  ): void => {
    console.log('Row clicked for game:', row.original.name)
    setDialogGame(row.original)
    setIsDialogOpen(true)
  }

  // Simple handler to close main dialog
  const handleCloseDialog = useCallback((): void => {
    setIsDialogOpen(false)
    setTimeout(() => {
      setDialogGame(null)
    }, 300)
  }, [])

  // Placeholder actions - Ensure they close the dialog
  const handleInstall = (game: GameInfo | null): void => {
    if (!game) return
    console.log('Install action triggered for:', game.packageName)
    addDownloadToQueue(game)
      .then((success) => {
        if (success) {
          console.log(`Successfully added ${game.releaseName} to download queue.`)
          // Optionally navigate to downloads view or show notification?
        } else {
          console.log(`Failed to add ${game.releaseName} to queue (might already exist).`)
          // Optionally show notification?
        }
      })
      .catch((err) => {
        console.error('Error adding to queue:', err)
        // Show error notification?
      })
    handleCloseDialog()
  }
  const handleReinstall = (game: GameInfo | null): void => {
    if (!game) return
    console.log('Reinstall action triggered for:', game.packageName)
    // Basic Reinstall: Just add to download queue again
    addDownloadToQueue(game)
      .then((success) => {
        if (success) {
          console.log(`Successfully added ${game.releaseName} to queue for reinstall.`)
        } else {
          console.log(
            `Failed to add ${game.releaseName} to queue for reinstall (might already exist).`
          )
        }
      })
      .catch((err) => console.error('Error adding to queue for reinstall:', err))
    handleCloseDialog()
  }
  const handleUpdate = (game: GameInfo | null): void => {
    if (!game) return
    console.log('Update action triggered for:', game.packageName)
    // Basic Update: Just add to download queue again
    addDownloadToQueue(game)
      .then((success) => {
        if (success) {
          console.log(`Successfully added ${game.releaseName} to queue for update.`)
        } else {
          console.log(
            `Failed to add ${game.releaseName} to queue for update (might already exist).`
          )
        }
      })
      .catch((err) => console.error('Error adding to queue for update:', err))
    handleCloseDialog()
  }

  // Action for retrying download/install
  const handleRetry = (game: GameInfo | null): void => {
    if (!game || !game.releaseName) return
    console.log('Retry action triggered for:', game.releaseName)
    retryDownload(game.releaseName) // Call retryDownload from the hook
    handleCloseDialog()
  }

  // Action for cancelling download/extraction
  const handleCancelDownload = (game: GameInfo | null): void => {
    if (!game || !game.releaseName) return
    console.log('Cancel download/extraction action triggered for:', game.releaseName)
    cancelDownload(game.releaseName) // Call `cancelDownload` from the hook
    handleCloseDialog()
  }

  // Helper function to render action buttons based on game state
  const renderActionButtons = (game: GameInfo | null): React.ReactNode => {
    if (!game) return null

    const status = downloadStatusMap.get(game.releaseName || '')?.status
    const canCancel = status === 'Downloading' || status === 'Extracting' || status === 'Queued'
    const isDownloaded = status === 'Completed'
    const isInstalled = game.isInstalled
    const hasUpdate = game.hasUpdate
    const isInstallError = status === 'InstallError' // Check specifically for InstallError
    const isErrorOrCancelled = status === 'Error' || status === 'Cancelled'

    // Show cancel button if Downloading, Extracting, or Queued
    if (canCancel) {
      return (
        <Button
          appearance="danger"
          icon={<DismissRegular />}
          onClick={() => handleCancelDownload(game)}
        >
          Cancel Download
        </Button>
      )
    }

    // Handle InstallError or regular Error/Cancelled states with Retry
    if (isInstallError || isErrorOrCancelled) {
      return (
        <>
          <Button
            appearance="primary"
            icon={<ArrowClockwiseRegular />} // Use retry icon
            onClick={() => handleRetry(game)} // Call retry handler
            disabled={isBusy}
          >
            Retry
          </Button>
          {/* Optionally allow deleting files even after error */}
          <Button
            appearance="danger"
            icon={<DeleteRegular />}
            onClick={() => handleDeleteDownloaded(game)}
            disabled={isBusy}
          >
            Delete Downloaded Files
          </Button>
        </>
      )
    }

    // Existing logic for other states (Install, Update, Reinstall, Delete)
    if (isInstalled) {
      if (hasUpdate) {
        return (
          <>
            <Button
              appearance="primary"
              icon={<ArrowUpRegular />}
              onClick={() => handleUpdate(game)}
              disabled={!isConnected || isBusy}
            >
              Update
            </Button>
            <Button
              appearance="danger"
              icon={<DeleteRegular />}
              onClick={handleDeleteRequest}
              disabled={!isConnected || isBusy}
            >
              Delete
            </Button>
          </>
        )
      } else {
        return (
          <>
            <Button
              appearance="secondary"
              icon={<ArrowSyncRegular />}
              onClick={() => handleReinstall(game)}
              disabled={!isConnected || isBusy}
            >
              Reinstall
            </Button>
            <Button
              appearance="danger"
              icon={<DeleteRegular />}
              onClick={handleDeleteRequest}
              disabled={!isConnected || isBusy}
            >
              Delete
            </Button>
          </>
        )
      }
    }

    if (isDownloaded) {
      return (
        <>
          <Button
            appearance="primary"
            icon={<CheckmarkCircleRegular />}
            onClick={() => {
              if (game?.releaseName && selectedDevice) {
                console.log(
                  `Requesting install from completed for ${game.releaseName} on ${selectedDevice}`
                )
                window.api.downloads
                  .installFromCompleted(game.releaseName, selectedDevice)
                  .catch((err) => {
                    console.error('Error triggering install from completed:', err)
                    window.alert(
                      'Failed to start installation. Please check the main process logs.'
                    )
                  })
                handleCloseDialog() // Close dialog after triggering
              } else {
                console.error('Missing releaseName or deviceId for install action')
                window.alert('Cannot start installation: Missing required information.')
              }
            }}
            disabled={!isConnected || isBusy || !selectedDevice}
          >
            Install
          </Button>
          <Button
            appearance="danger"
            icon={<DeleteRegular />}
            onClick={() => handleDeleteDownloaded(game)}
          >
            Delete Downloaded Files
          </Button>
        </>
      )
    }

    // Default: Show Install button
    return (
      <Button
        appearance="primary"
        icon={<DownloadIcon />}
        onClick={() => handleInstall(game)}
        disabled={isBusy}
      >
        Install
      </Button>
    )
  }

  // Delete Action - Opens confirmation dialog
  const handleDeleteRequest = (): void => {
    console.log('Delete requested for:', dialogGame?.packageName)
    setIsDeleteConfirmOpen(true)
  }

  // Confirmed Delete Action - Performs delete and closes dialogs
  const handleConfirmDelete = useCallback(async (): Promise<void> => {
    if (!dialogGame || !selectedDevice || !dialogGame.packageName) return

    const gameToDelete = { ...dialogGame } // Capture game before closing dialogs
    setIsDeleteConfirmOpen(false) // Close confirmation
    setIsDialogOpen(false) // Close main action dialog
    setDialogGame(null) // Clear game data

    console.log(`Proceeding with uninstall for ${gameToDelete.packageName}...`)
    setIsLoading(true)
    try {
      const success = await window.api.adb.uninstallPackage(
        selectedDevice,
        gameToDelete.packageName
      )
      if (success) {
        console.log('Uninstall successful, refreshing package list...')
        await loadPackages()
      } else {
        console.error('Uninstall failed.')
        window.alert('Failed to uninstall the game.')
      }
    } catch (error) {
      console.error('Error during uninstall IPC call:', error)
      window.alert('An error occurred during uninstallation.')
    } finally {
      setIsLoading(false)
    }
  }, [dialogGame, selectedDevice, loadPackages]) // Dependencies

  // Placeholder action for deleting downloaded files
  const handleDeleteDownloaded = useCallback(
    async (game: GameInfo | null): Promise<void> => {
      if (!game || !game.releaseName) return
      console.log('Delete downloaded files action triggered for:', game.releaseName)
      try {
        const success = await deleteFiles(game.releaseName)
        if (success) {
          console.log(`Successfully requested deletion of files for ${game.releaseName}.`)
          // Queue update handled by listener
        } else {
          console.error(`Failed to delete files for ${game.releaseName}.`)
          // Optionally show an error to the user
          window.alert('Failed to delete downloaded files. Check logs.')
        }
      } catch (error) {
        console.error('Error calling deleteFiles:', error)
        window.alert('An error occurred while trying to delete downloaded files.')
      }
      handleCloseDialog()
    },
    [deleteFiles, handleCloseDialog]
  )

  // Combine loading states for display/disabling elements
  const isBusy = adbLoading || loadingGames || isLoading

  return (
    <div className="games-view">
      {/* <div className="games-header">
        <div className="games-header-left">
          <button className="back-button" onClick={onBackToDevices}>
            ← Back to Devices
          </button>
          <h2>VR Games Library</h2>
        </div>

        <div className="device-info-bar">
          {isConnected ? (
            <>
              <span className="connected-device">
                Connected to: <strong>{selectedDevice}</strong>
              </span>
              <button className="disconnect-button" onClick={disconnectDevice}>
                Disconnect
              </button>
            </>
          ) : (
            <span className="device-warning">No device connected</span>
          )}
        </div>
      </div> */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Button icon={<ArrowLeftRegular />} onClick={onBackToDevices} appearance="transparent">
            Back to Devices
          </Button>
          <Title2>VR Games Library</Title2>
        </div>
        <div className={styles.deviceInfoBar}>
          {isConnected ? (
            <>
              <Text className={styles.connectedDeviceText}>
                <CheckmarkCircleRegular fontSize={16} color={tokens.colorPaletteGreenForeground1} />
                Connected: <strong>{selectedDevice}</strong>
              </Text>
              <Button
                icon={<DismissRegular />}
                onClick={disconnectDevice}
                appearance="subtle"
                size="small"
                aria-label="Disconnect device"
              />
            </>
          ) : (
            <Text className={styles.deviceWarningText}>
              <PlugDisconnectedRegular fontSize={16} /> No device connected
            </Text>
          )}
        </div>
      </header>

      <div className="games-container-table">
        <div className="games-toolbar">
          <div className="games-toolbar-left">
            <Button icon={<ArrowClockwiseRegular />} onClick={refreshGames} disabled={isBusy}>
              {isBusy ? 'Working...' : 'Refresh Games'}
            </Button>
            <span className="last-synced">Last synced: {formatDate(lastSyncTime)}</span>
            {/* Install Status Filter Buttons */}
            {isConnected && (
              <div className="filter-buttons">
                <button
                  onClick={() => setActiveFilter('all')}
                  className={activeFilter === 'all' ? 'active' : ''}
                >
                  All ({counts.total})
                </button>
                <button
                  onClick={() => setActiveFilter('installed')}
                  className={activeFilter === 'installed' ? 'active' : ''}
                >
                  Installed ({counts.installed})
                </button>
                <button
                  onClick={() => setActiveFilter('update')}
                  className={activeFilter === 'update' ? 'active' : ''}
                  disabled={counts.updates === 0} // Disable if no updates
                >
                  Updates ({counts.updates})
                </button>
              </div>
            )}
          </div>
          <div className="games-toolbar-right">
            <span className="game-count">{table.getFilteredRowModel().rows.length} displayed</span>
            <Input
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(String(e.target.value))}
              placeholder="Search name/package..."
              type="search"
            />
          </div>
        </div>

        {isBusy && !loadingGames && !downloadProgress && !extractProgress && (
          <div className="loading-indicator">Processing...</div>
        )}

        {loadingGames && (downloadProgress > 0 || extractProgress > 0) && (
          <div className="download-progress">
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${getCurrentProgress()}%` }} />
            </div>
            <div className="progress-text">{getProcessMessage()}</div>
          </div>
        )}

        {loadingGames && !downloadProgress && !extractProgress ? (
          <div className="loading-indicator">Loading games library...</div>
        ) : gamesError ? (
          <div className="error-message">{gamesError}</div>
        ) : games.length === 0 && !loadingGames ? (
          <div className="no-games-message">
            No games found. Click &quot;Refresh Games&quot; to sync the game library.
          </div>
        ) : (
          <>
            <div className="table-wrapper" ref={tableContainerRef}>
              <table className="games-table" style={{ width: table.getTotalSize() }}>
                <thead
                  style={{
                    display: 'grid',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1
                  }}
                >
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          colSpan={header.colSpan}
                          style={{ width: header.getSize(), position: 'relative' }}
                        >
                          {header.isPlaceholder ? null : (
                            <div
                              {...{
                                className: header.column.getCanSort()
                                  ? 'cursor-pointer select-none'
                                  : '',
                                onClick: header.column.getToggleSortingHandler()
                              }}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {{
                                asc: ' 🔼',
                                desc: ' 🔽'
                              }[header.column.getIsSorted() as string] ?? null}
                            </div>
                          )}
                          {header.column.getCanResize() && (
                            <div
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              className={`${styles.resizer} ${header.column.getIsResizing() ? styles.isResizing : ''}`}
                            />
                          )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                {/* Virtualized Table Body */}
                <tbody
                  style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index] as Row<GameInfo> // Get the actual row data
                    // Combine class names
                    const rowClasses = [
                      row.original.isInstalled ? 'row-installed' : 'row-not-installed',
                      row.original.hasUpdate ? 'row-update-available' : ''
                    ]
                      .filter(Boolean) // Remove empty strings
                      .join(' ')

                    return (
                      <tr
                        key={row.id}
                        className={rowClasses} // Apply combined classes
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`
                        }}
                        onClick={(e) => handleRowClick(e, row)} // Add onClick handler
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            style={{
                              width: cell.column.getSize(),
                              maxWidth: cell.column.getSize()
                            }}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ---- Main Action Dialog ---- */}
            <Dialog
              open={isDialogOpen}
              onOpenChange={(_e, data) => !data.open && handleCloseDialog()}
              modalType="modal"
            >
              <DialogSurface mountNode={document.querySelector('#portal')}>
                <DialogBody>
                  <DialogTitle>{dialogGame?.name}</DialogTitle>
                  <DialogContent>
                    {/* Game Details */}
                    {dialogGame && (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '150px 1fr',
                          gap: tokens.spacingHorizontalL,
                          marginTop: tokens.spacingVerticalL,
                          marginBottom: tokens.spacingVerticalXL,
                          alignItems: 'start'
                        }}
                      >
                        {/* Left Column: Thumbnail */}
                        <div>
                          <Image
                            src={
                              dialogGame.thumbnailPath
                                ? `file://${dialogGame.thumbnailPath}`
                                : placeholderImage
                            }
                            alt={`${dialogGame.name} thumbnail`}
                            shape="rounded"
                            width={150}
                            height={150}
                            fit="cover"
                          />
                        </div>

                        {/* Right Column: Details (Using Flexbox now) */}
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: tokens.spacingVerticalL
                          }}
                        >
                          {/* Top Info: Name, Package, Status */}
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: tokens.spacingVerticalXS
                            }}
                          >
                            <Text size={600} weight="semibold">
                              {dialogGame.name}
                            </Text>
                            <Text
                              size={300}
                              weight="regular"
                              style={{ color: tokens.colorNeutralForeground2 }}
                            >
                              {dialogGame.packageName}
                            </Text>
                            {/* Container for Badges and Inline Info */}
                            <div
                              style={{
                                display: 'flex',
                                gap: tokens.spacingHorizontalL,
                                alignItems: 'center',
                                marginTop: tokens.spacingVerticalS,
                                flexWrap: 'wrap'
                              }}
                            >
                              {/* Status Badges */}
                              <div
                                style={{
                                  display: 'flex',
                                  gap: tokens.spacingHorizontalS,
                                  alignItems: 'center'
                                }}
                              >
                                <Badge
                                  shape="rounded"
                                  color={(() => {
                                    const status = downloadStatusMap.get(
                                      dialogGame.releaseName || ''
                                    )?.status
                                    if (dialogGame.isInstalled) return 'success'
                                    if (status === 'Completed') return 'brand'
                                    if (status === 'InstallError') return 'danger'
                                    return 'informative' // Default for others
                                  })()}
                                  appearance="filled"
                                >
                                  {(() => {
                                    const status = downloadStatusMap.get(
                                      dialogGame.releaseName || ''
                                    )?.status
                                    if (dialogGame.isInstalled) return 'Installed'
                                    if (status === 'Completed') return 'Downloaded'
                                    if (status === 'InstallError') return 'Install Error'
                                    return 'Not Installed' // Default
                                  })()}
                                </Badge>
                                {dialogGame.hasUpdate && (
                                  <Badge shape="rounded" color="brand" appearance="filled">
                                    Update Available
                                  </Badge>
                                )}
                              </div>
                              {/* Inline Info: Size */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: tokens.spacingHorizontalXS
                                }}
                              >
                                <DocumentDataRegular fontSize={16} />
                                <Text size={300}>{dialogGame.size || '-'}</Text>
                              </div>
                              {/* Inline Info: Downloads */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: tokens.spacingHorizontalXS
                                }}
                              >
                                <DownloadIcon fontSize={16} />
                                <Text size={300}>
                                  {dialogGame.downloads?.toLocaleString() || '-'}
                                </Text>
                              </div>
                            </div>
                          </div>

                          {/* Divider */}
                          <Divider />

                          {/* Detail List with Icons (Size and Downloads Removed) */}
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: tokens.spacingVerticalM
                            }}
                          >
                            {/* Version Info */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: tokens.spacingHorizontalS
                              }}
                            >
                              <InfoRegular fontSize={16} />
                              <Text>
                                {dialogGame.version ? `v${dialogGame.version}` : '-'}
                                {dialogGame.isInstalled &&
                                  dialogGame.deviceVersionCode &&
                                  ` (Device: v${dialogGame.deviceVersionCode})`}
                              </Text>
                            </div>
                            {/* Release Name */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: tokens.spacingHorizontalS
                              }}
                            >
                              <TagRegular fontSize={16} />
                              <Text>{dialogGame.releaseName || '-'}</Text>
                            </div>
                            {/* Size REMOVED */}
                            {/* Last Updated */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: tokens.spacingHorizontalS
                              }}
                            >
                              <CalendarClockRegular fontSize={16} />
                              <Text>{dialogGame.lastUpdated || '-'}</Text>
                            </div>
                            {/* Downloads REMOVED */}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Divider before Note */}
                    <Divider style={{ marginTop: tokens.spacingVerticalS }} />

                    {/* Note Section */}
                    {dialogGame && (
                      <div
                        style={{
                          marginTop: tokens.spacingVerticalL,
                          marginBottom: tokens.spacingVerticalL
                        }}
                      >
                        <Text
                          weight="semibold"
                          style={{ marginBottom: tokens.spacingVerticalS, display: 'block' }}
                        >
                          Note:
                        </Text>
                        {loadingNote ? (
                          <Text>Loading note...</Text>
                        ) : currentGameNote ? (
                          // Using a pre-wrap div to respect newlines in the note
                          <div
                            style={{
                              whiteSpace: 'pre-wrap',
                              maxHeight: '150px',
                              overflowY: 'auto',
                              backgroundColor: tokens.colorNeutralBackground2,
                              padding: tokens.spacingVerticalS,
                              borderRadius: tokens.borderRadiusMedium
                            }}
                          >
                            <Text>{currentGameNote}</Text>
                          </div>
                        ) : (
                          <Text>No note available.</Text>
                        )}
                      </div>
                    )}

                    {/* Actions List - Adding Icons */}
                    {dialogGame && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: tokens.spacingVerticalS
                        }}
                      >
                        {renderActionButtons(dialogGame)}
                      </div>
                    )}
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button appearance="secondary" onClick={handleCloseDialog}>
                        Close
                      </Button>
                    </DialogTrigger>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>

            {/* ---- Delete Confirmation Dialog ---- */}
            <Dialog
              open={isDeleteConfirmOpen}
              onOpenChange={(_e, data) => !data.open && setIsDeleteConfirmOpen(false)}
              modalType="alert"
            >
              <DialogSurface mountNode={document.querySelector('#portal')}>
                <DialogBody>
                  <DialogTitle>Confirm Uninstall</DialogTitle>
                  <div>
                    Are you sure you want to uninstall
                    <strong> {dialogGame?.name} </strong>({dialogGame?.packageName})? This will also
                    remove associated OBB and Data files.
                  </div>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button appearance="secondary" onClick={() => setIsDeleteConfirmOpen(false)}>
                        Cancel
                      </Button>
                    </DialogTrigger>
                    <Button appearance="primary" onClick={handleConfirmDelete}>
                      Uninstall
                    </Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          </>
        )}
      </div>
    </div>
  )
}

export default GamesView
