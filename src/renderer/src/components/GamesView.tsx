import React, { useState, useMemo, useEffect, useRef } from 'react'
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

const GamesView: React.FC<GamesViewProps> = ({ onBackToDevices }) => {
  const { selectedDevice, isConnected, disconnectDevice, isLoading: adbLoading } = useAdb()
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
  const [installedFilter, setInstalledFilter] = useState<'all' | 'installed' | 'not_installed'>(
    'all'
  )

  // Update column filter when installedFilter state changes
  useEffect(() => {
    if (installedFilter === 'all') {
      setColumnFilters((prev) => prev.filter((f) => f.id !== 'isInstalled'))
    } else {
      setColumnFilters((prev) => [
        ...prev.filter((f) => f.id !== 'isInstalled'),
        { id: 'isInstalled', value: installedFilter === 'installed' }
      ])
    }
  }, [installedFilter])

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
        size: 670, // Restore a default size
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
        size: 120,
        cell: (info) => (info.getValue() ? `v${info.getValue()}` : '-')
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
      columnVisibility: { isInstalled: false }
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
  const tableContainerRef = useRef<HTMLDivElement>(null)
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

      <div className="games-container-table">
        <div className="games-toolbar">
          <div className="games-toolbar-left">
            <button
              className="refresh-button"
              onClick={refreshGames}
              disabled={loadingGames || adbLoading}
            >
              {loadingGames ? 'Refreshing...' : 'Refresh Games'}
            </button>
            <span className="last-synced">Last synced: {formatDate(lastSyncTime)}</span>
            {/* Install Status Filter Buttons */}
            {isConnected && (
              <div className="filter-buttons">
                <button
                  onClick={() => setInstalledFilter('all')}
                  className={installedFilter === 'all' ? 'active' : ''}
                >
                  All
                </button>
                <button
                  onClick={() => setInstalledFilter('installed')}
                  className={installedFilter === 'installed' ? 'active' : ''}
                >
                  Installed
                </button>
                <button
                  onClick={() => setInstalledFilter('not_installed')}
                  className={installedFilter === 'not_installed' ? 'active' : ''}
                >
                  Not Installed
                </button>
              </div>
            )}
          </div>
          <div className="games-toolbar-right">
            <span className="game-count">
              {table.getFilteredRowModel().rows.length} / {games.length} games
            </span>
            <input
              type="text"
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(String(e.target.value))}
              className="search-input"
              placeholder="Search name/package..."
            />
          </div>
        </div>

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
            <div ref={tableContainerRef} className="table-wrapper">
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
                    return (
                      <tr
                        key={row.id}
                        className={row.original.isInstalled ? 'row-installed' : 'row-not-installed'}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`
                        }}
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
          </>
        )}
      </div>
    </div>
  )
}

export default GamesView
