import React from 'react'
import { useAdb } from '../hooks/useAdb'

interface DeviceListProps {
  onSkip?: () => void
  onConnected?: () => void
}

const DeviceList: React.FC<DeviceListProps> = ({ onSkip, onConnected }) => {
  const {
    devices,
    selectedDevice,
    isConnected,
    isLoading,
    error,
    connectToDevice,
    refreshDevices
  } = useAdb()

  // Connect to a device and call onConnected callback if provided
  const handleConnect = async (serial: string): Promise<void> => {
    const success = await connectToDevice(serial)
    if (success && onConnected) {
      onConnected()
    }
  }

  return (
    <div className="device-list">
      <h2>Meta Quest Devices</h2>

      <div className="device-list-header">
        <div className="device-list-actions">
          <button onClick={() => refreshDevices()} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>

          {onSkip && (
            <button className="skip-button" onClick={onSkip}>
              Skip Connection
            </button>
          )}
        </div>

        {error && <div className="error-message">{error}</div>}
      </div>

      {devices.length === 0 ? (
        <div className="no-devices">
          {isLoading ? 'Searching for devices...' : 'No devices found'}
        </div>
      ) : (
        <ul className="devices">
          {devices.map((device) => (
            <li
              key={device.id}
              className={`device-item ${selectedDevice === device.id ? 'selected' : ''}`}
            >
              <div className="device-info">
                <div className="device-id">{device.id}</div>
                <div className="device-type">{device.type}</div>
              </div>
              <button
                onClick={() => handleConnect(device.id)}
                disabled={selectedDevice === device.id && isConnected}
              >
                {selectedDevice === device.id && isConnected ? 'Connected' : 'Connect'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default DeviceList
