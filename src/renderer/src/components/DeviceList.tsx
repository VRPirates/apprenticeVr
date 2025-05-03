import React, { useEffect, useState } from 'react'
import { DeviceInfo } from '../types/adb'

const DeviceList: React.FC = () => {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  // Load devices when component mounts
  useEffect(() => {
    loadDevices()

    // Start device tracking
    window.api.adb.startTrackingDevices()

    // Device listeners
    const removeDeviceAdded = window.api.adb.onDeviceAdded((device) => {
      setDevices((prevDevices) => {
        // Check if device already exists
        if (prevDevices.some((d) => d.id === device.id)) {
          return prevDevices
        }
        return [...prevDevices, device]
      })
    })

    const removeDeviceRemoved = window.api.adb.onDeviceRemoved((device) => {
      setDevices((prevDevices) => prevDevices.filter((d) => d.id !== device.id))

      // If currently selected device was removed, reset the connection
      if (selectedDevice === device.id) {
        setSelectedDevice(null)
        setIsConnected(false)
      }
    })

    const removeDeviceChanged = window.api.adb.onDeviceChanged((device) => {
      setDevices((prevDevices) => prevDevices.map((d) => (d.id === device.id ? device : d)))
    })

    const removeTrackerError = window.api.adb.onTrackerError((errorMsg) => {
      setError(`Device tracking error: ${errorMsg}`)
    })

    // Cleanup listeners when component unmounts
    return () => {
      window.api.adb.stopTrackingDevices()
      removeDeviceAdded()
      removeDeviceRemoved()
      removeDeviceChanged()
      removeTrackerError()
    }
  }, [selectedDevice])

  // Load available devices
  const loadDevices = async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)
      const deviceList = await window.api.adb.listDevices()
      setDevices(deviceList)
    } catch (err) {
      setError('Failed to load devices')
      console.error('Error loading devices:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Connect to a device
  const connectToDevice = async (serial: string): Promise<void> => {
    try {
      setError(null)
      const success = await window.api.adb.connectDevice(serial)
      if (success) {
        setSelectedDevice(serial)
        setIsConnected(true)
      } else {
        setError(`Failed to connect to device ${serial}`)
      }
    } catch (err) {
      setError('Connection error')
      console.error('Error connecting to device:', err)
    }
  }

  // Handle refresh button click
  const handleRefresh = (): void => {
    loadDevices()
  }

  return (
    <div className="device-list">
      <h2>Meta Quest Devices</h2>

      <div className="device-list-header">
        <button onClick={handleRefresh} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
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
                onClick={() => connectToDevice(device.id)}
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
