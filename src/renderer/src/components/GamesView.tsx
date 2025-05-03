import React from 'react'
import { useAdb } from '../hooks/useAdb'

interface GamesViewProps {
  onBackToDevices: () => void
}

const GamesView: React.FC<GamesViewProps> = ({ onBackToDevices }) => {
  const { selectedDevice, isConnected, disconnectDevice, packages, loadingPackages, loadPackages } =
    useAdb()

  // Handle disconnect and navigation back to device list
  const handleDisconnectAndGoBack = (): void => {
    if (isConnected) {
      disconnectDevice()
    }
    onBackToDevices()
  }

  // Handle refresh packages
  const handleRefreshPackages = (): void => {
    if (isConnected && selectedDevice) {
      loadPackages()
    }
  }

  return (
    <div className="games-view">
      <div className="games-header">
        <div className="games-header-left">
          <button className="back-button" onClick={onBackToDevices}>
            ← Back to Devices
          </button>
          <h2>Games on Your Meta Quest</h2>
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

      <div className="games-container">
        {isConnected ? (
          <>
            <div className="games-toolbar">
              <button
                className="refresh-button"
                onClick={handleRefreshPackages}
                disabled={loadingPackages}
              >
                {loadingPackages ? 'Loading...' : 'Refresh Games'}
              </button>
              <div className="game-count">{packages.length} games found</div>
            </div>

            {loadingPackages ? (
              <div className="loading-indicator">Loading games from device...</div>
            ) : packages.length === 0 ? (
              <div className="no-games-message">No games found on this device.</div>
            ) : (
              <ul className="games-list">
                {packages.map((pkg) => (
                  <li key={pkg.packageName} className="game-item">
                    <div className="game-info">
                      <div className="package-name">{pkg.packageName}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="games-placeholder">
            <p>
              Connect to your Quest to see your installed games. You&apos;ll be able to manage and
              launch games from here.
            </p>
            <button className="connect-device-button" onClick={handleDisconnectAndGoBack}>
              Connect to Device
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default GamesView
