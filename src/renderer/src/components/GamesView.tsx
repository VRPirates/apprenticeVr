import React from 'react'
import { useAdb } from '../hooks/useAdb'

const GamesView: React.FC = () => {
  const { selectedDevice, isConnected, disconnectDevice } = useAdb()

  return (
    <div className="games-view">
      <div className="games-header">
        <h2>Games on Your Meta Quest</h2>

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
            <p>Please connect to a device to see your games.</p>
          )}
        </div>

        {/* Game list will be implemented here */}
      </div>
    </div>
  )
}

export default GamesView
