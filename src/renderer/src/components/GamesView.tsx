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
import { GameInfo } from '../types/adb' // Make sure GameInfo is imported
import placeholderImage from '../assets/images/game-placeholder.png'

interface GamesViewProps {
  onBackToDevices: () => void
}

// Define the expanded filter type
type FilterType = 'all' | 'installed' | 'update'

// Filter function specifically for game name AND package name
const filterGameNameAndPackage: FilterFn<GameInfo> = (row, columnId, filterValue) => {
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

// Simple Popover Component (can be moved to its own file)
interface GameActionPopoverProps {
  game: GameInfo | null
  position: { top: number; left: number } | null
  onClose: () => void
  onDelete: (game: GameInfo) => void // Add other actions later (onInstall, onReinstall, onUpdate)
}

const GameActionPopover: React.FC<GameActionPopoverProps> = ({
  game,
  position,
  onClose,
  onDelete
}) => {
  if (!game || !position) return null

  const isInstalled = game.isInstalled
  const hasUpdate = game.hasUpdate

  const handleActionClick = (action: () => void): void => {
    action()
    onClose()
  }

  // Placeholder actions
  const handleInstall = (): void => console.log('Install clicked for:', game.packageName)
  const handleReinstall = (): void => console.log('Reinstall clicked for:', game.packageName)
  const handleUpdate = (): void => console.log('Update clicked for:', game.packageName)

  return (
    <div
      className="game-action-popover"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      // Add click outside listener later if needed
    >
      <div className="popover-header">
        <span>{game.name}</span>
        <button
          onClick={() => handleActionClick(() => onDelete(game))}
          className="close-popover-btn"
        >
          ×
        </button>
      </div>
      <ul className="popover-actions">
        {!isInstalled && <li onClick={() => handleActionClick(() => handleInstall())}>Install</li>}
        {isInstalled && !hasUpdate && (
          <>
            <li onClick={() => handleActionClick(() => handleReinstall())}>Reinstall</li>
            <li onClick={() => handleActionClick(() => onDelete(game))}>Delete</li>
          </>
        )}
        {isInstalled && hasUpdate && (
          <>
            <li onClick={() => handleActionClick(() => handleUpdate())}>Update</li>
            <li onClick={() => handleActionClick(() => onDelete(game))}>Delete</li>
          </>
        )}
      </ul>
    </div>
  )
}

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
    refreshGames
  } = useGames()

  const [globalFilter, setGlobalFilter] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [popoverGame, setPopoverGame] = useState<GameInfo | null>(null)
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null) // Ref for the popover element itself

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

  // Columns definition updated
  const columns = useMemo<ColumnDef<GameInfo>[]>(
    () => [
      {
        accessorKey: 'thumbnailPath',
        header: ' ',
        size: 90, // Adjusted size
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
        accessorKey: 'name', // Keep accessor as 'name' for sorting
        header: 'Name / Package',
        size: 600, // Restore a default size
        cell: ({ row }) => (
          <div className="name-package-cell">
            <div className="game-name-main">{row.original.name}</div>
            <div className="game-package-sub">{row.original.packageName}</div>
          </div>
        )
        // Note: Sorting will only sort by game name due to accessorKey
        // Custom sorting function needed if sorting by package is desired
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
        }
      },
      {
        accessorKey: 'size',
        header: 'Size',
        size: 90,
        cell: (info) => info.getValue() || '-'
      },
      {
        accessorKey: 'lastUpdated',
        header: 'Last Updated',
        size: 180,
        cell: (info) => info.getValue() || '-'
      },
      // REMOVED Package Name column
      {
        accessorKey: 'isInstalled', // Hidden column remains
        header: 'Installed Status',
        enableResizing: false
      },
      {
        accessorKey: 'hasUpdate',
        header: 'Update Status',
        enableResizing: false
      }
    ],
    []
  )

  const table = useReactTable({
    data: games,
    columns,
    columnResizeMode: 'onChange',
    filterFns: {
      // Register the combined filter
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
    // Use the combined filter for global search
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

  // Handle Row Click - Consolidated Logic
  const handleRowClick = (
    event: React.MouseEvent<HTMLTableRowElement>,
    row: Row<GameInfo>
  ): void => {
    // If the click is inside the currently open popover, let the popover handle it (e.g., action clicks)
    if (popoverRef.current && popoverRef.current.contains(event.target as Node)) {
      console.log('Row click ignored: click target was inside the popover.')
      return
    }

    // If a popover is open (and the click wasn't inside it), close it.
    if (popoverGame) {
      console.log('Row click detected while popover open (click outside popover), closing.')
      handleClosePopover()
      // We stop here because the requirement is to not open a new one immediately
      return
    }

    // If we reach here, no popover was open, and the click wasn't inside a potential popover.
    // So, open a new one for the clicked row.
    console.log('No popover open, opening for row:', row.original.id)
    const clickY = event.clientY
    const clickX = event.clientX
    setPopoverPosition({ top: clickY + 5, left: clickX + 5 })
    setPopoverGame(row.original)
  }

  const handleClosePopover = useCallback((): void => {
    // Only log if actually closing
    if (popoverGame) {
      console.log('Closing popover')
      setPopoverGame(null)
      setPopoverPosition(null)
    }
  }, [popoverGame]) // Add popoverGame dependency to useCallback if logging change

  // Click Outside Handler (Handles clicks truly outside the table/popover area)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      // Double check: Popover exists, Ref exists, and click is outside Ref
      if (popoverGame && popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        // Important: Check if the click target is *also* outside the rows/table area
        // to prevent conflict with handleRowClick. Clicks on rows are handled by handleRowClick now.
        if (!tableContainerRef.current?.contains(event.target as Node)) {
          console.log(
            'Document click listener: Target outside table container and popover, closing.'
          )
          handleClosePopover()
        } else {
          console.log(
            'Document click listener: Target inside table container, ignored (handled by row click).'
          )
        }
      }
    }

    if (popoverPosition) {
      document.addEventListener('mousedown', handleClickOutside)
    } else {
      document.removeEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
    // Update dependencies for useCallback change
  }, [popoverPosition, popoverGame, handleClosePopover])

  // Handle Delete Action
  const handleDeleteGame = useCallback(
    async (gameToDelete: GameInfo): Promise<void> => {
      if (!selectedDevice || !gameToDelete.packageName) return

      const confirmDelete = window.confirm(
        `Are you sure you want to uninstall ${gameToDelete.name} (${gameToDelete.packageName})? This will also remove associated OBB and Data files.`
      )

      if (confirmDelete) {
        console.log(`Uninstalling ${gameToDelete.packageName}...`)
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
      }
    },
    [selectedDevice, loadPackages]
  )

  // Combine loading states for display/disabling elements
  const isBusy = adbLoading || loadingGames || isLoading

  return (
    <div className="games-view">
      <div className="games-header">
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
      </div>

      <div className="games-container-table" ref={tableContainerRef}>
        <div className="games-toolbar">
          <div className="games-toolbar-left">
            <button className="refresh-button" onClick={refreshGames} disabled={isBusy}>
              {isBusy ? 'Working...' : 'Refresh Games'}
            </button>
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
            <input
              type="text"
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(String(e.target.value))}
              className="search-input"
              placeholder="Search name/package..."
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
            <div className="table-wrapper">
              <table className="games-table" style={{ width: table.getTotalSize() }}>
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          colSpan={header.colSpan}
                          style={{ width: header.getSize() }} // Use header size for width
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
                          {/* Add Resizer Element */}
                          {header.column.getCanResize() && (
                            <div
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              className={`resizer ${header.column.getIsResizing() ? 'isResizing' : ''}`}
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
            {/* Render Popover and forward the ref */}
            <div ref={popoverRef}>
              <GameActionPopover
                game={popoverGame}
                position={popoverPosition}
                onClose={handleClosePopover}
                onDelete={handleDeleteGame}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default GamesView
