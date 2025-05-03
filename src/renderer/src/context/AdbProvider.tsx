import React, { useEffect, useState, ReactNode } from 'react'
import { DeviceInfo } from '../types/adb'
import { AdbContext } from './AdbContext'

interface AdbProviderProps {
  children: ReactNode
}

export const AdbProvider: React.FC<AdbProviderProps> = ({ children }) => {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  // Initialize device tracking when provider mounts
  useEffect(() => {
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

    // Initial device load
    refreshDevices()

    // Cleanup listeners when provider unmounts
    return () => {
      window.api.adb.stopTrackingDevices()
      removeDeviceAdded()
      removeDeviceRemoved()
      removeDeviceChanged()
      removeTrackerError()
    }
  }, [selectedDevice])

  // Load available devices
  const refreshDevices = async (): Promise<void> => {
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
  const connectToDevice = async (serial: string): Promise<boolean> => {
    try {
      setError(null)
      const success = await window.api.adb.connectDevice(serial)
      if (success) {
        setSelectedDevice(serial)
        setIsConnected(true)
        return true
      } else {
        setError(`Failed to connect to device ${serial}`)
        return false
      }
    } catch (err) {
      setError('Connection error')
      console.error('Error connecting to device:', err)
      return false
    }
  }

  // Disconnect from device
  const disconnectDevice = (): void => {
    setSelectedDevice(null)
    setIsConnected(false)
  }

  const value = {
    devices,
    selectedDevice,
    isConnected,
    isLoading,
    error,
    connectToDevice,
    refreshDevices,
    disconnectDevice
  }

  return <AdbContext.Provider value={value}>{children}</AdbContext.Provider>
}
