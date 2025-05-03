import React from 'react'
import { useAdb } from '../hooks/useAdb'

interface GamesViewProps {
  onBackToDevices: () => void
}

const GamesView: React.FC<GamesViewProps> = ({ onBackToDevices }) => {
  const { selectedDevice, isConnected, disconnectDevice } = useAdb()

  // Handle disconnect and navigation back to device list
  const handleDisconnectAndGoBack = (): void => {
    if (isConnected) {
      disconnectDevice()
    }
    onBackToDevices()
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
        <div className="games-placeholder">
          <p>
            This is where your Quest games will be displayed. You&apos;ll be able to manage and
            launch games from here.
          </p>
          {isConnected ? (
            <p>Loading games from your connected device...</p>
          ) : (
            <>
              <p>Please connect to a device to see your games.</p>
              <button className="connect-device-button" onClick={handleDisconnectAndGoBack}>
                Connect to Device
              </button>
            </>
          )}
        </div>

        {/* Game list will be implemented here */}
      </div>
    </div>
  )
}

export default GamesView
