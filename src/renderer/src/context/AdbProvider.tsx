import React, { useEffect, useState, ReactNode, useCallback } from 'react'
import { DeviceInfo, PackageInfo } from '../types/adb'
import { AdbContext } from './AdbContext'
import { useDependency } from '@renderer/hooks/useDependency'

interface AdbProviderProps {
  children: ReactNode
}

export const AdbProvider: React.FC<AdbProviderProps> = ({ children }) => {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [packages, setPackages] = useState<PackageInfo[]>([])
  const [loadingPackages, setLoadingPackages] = useState<boolean>(false)
  const dependencyContext = useDependency()
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState<boolean>(false)
  const selectedDeviceDetails = devices.find((device) => device.id === selectedDevice) ?? null

  useEffect(() => {
    const initializeAndLoad = async (): Promise<void> => {
      if (dependencyContext.isReady && !isInitialLoadComplete) {
        console.log('Dependencies ready, initializing adb service...')
        try {
          setIsLoading(true)
          await window.api.initializeADBService()
          setIsLoading(false)
          setIsInitialLoadComplete(true)
        } catch (initError) {
          console.error('Failed to initialize adb service:', initError)
          setError(
            initError instanceof Error ? initError.message : 'Failed to initialize adb service'
          )
        }
      }
    }
    initializeAndLoad()
  }, [dependencyContext.isReady, isInitialLoadComplete])

  // Initialize device tracking when provider mounts
  useEffect(() => {
    if (!isInitialLoadComplete) return
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
        setPackages([]) // Clear packages when device is removed
      }
    })

    const removeDeviceChanged = window.api.adb.onDeviceChanged((device) => {
      // setDevices((prevDevices) => prevDevices.map((d) => (d.id === device.id ? device : d)))
      // Implement upsert logic for changed devices
      setDevices((prevDevices) => {
        const existingDeviceIndex = prevDevices.findIndex((d) => d.id === device.id)
        if (existingDeviceIndex !== -1) {
          // Device exists, update it
          const newDevices = [...prevDevices]
          newDevices[existingDeviceIndex] = device
          return newDevices
        } else {
          // Device doesn't exist, add it (handles transition from offline/auth to device)
          return [...prevDevices, device]
        }
      })
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
  }, [selectedDevice, isInitialLoadComplete])

  // Load installed packages from connected device
  const loadPackages = useCallback(async (): Promise<void> => {
    console.log('Loading packages for device:', selectedDevice)
    if (!selectedDevice) return
    try {
      setLoadingPackages(true)
      setError(null)
      const installedPackages = await window.api.adb.getInstalledPackages(selectedDevice)
      setPackages(installedPackages)
    } catch (err) {
      setError('Failed to load packages')
      console.error('Error loading packages:', err)
    } finally {
      setLoadingPackages(false)
    }
  }, [selectedDevice])

  // Load packages when device is connected
  useEffect(() => {
    if (isConnected && selectedDevice) {
      loadPackages()
    } else {
      setPackages([])
    }
  }, [isConnected, selectedDevice, loadPackages])

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
    setPackages([])
  }

  const value = {
    devices,
    selectedDevice,
    isConnected,
    isLoading,
    error,
    packages,
    loadingPackages,
    connectToDevice,
    refreshDevices,
    disconnectDevice,
    loadPackages,
    selectedDeviceDetails
  }

  if (!isInitialLoadComplete) {
    return <div>Loading...</div>
  }

  return <AdbContext.Provider value={value}>{children}</AdbContext.Provider>
}
