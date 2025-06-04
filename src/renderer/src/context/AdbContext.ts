import { PackageInfo, ExtendedDeviceInfo } from '@shared/types'
import { createContext } from 'react'

export interface AdbContextType {
  devices: ExtendedDeviceInfo[]
  selectedDevice: string | null
  selectedDeviceDetails: ExtendedDeviceInfo | null
  isConnected: boolean
  isLoading: boolean
  error: string | null
  packages: PackageInfo[]
  loadingPackages: boolean
  userName: string
  loadingUserName: boolean
  connectToDevice: (serial: string) => Promise<boolean>
  connectTcpDevice: (ipAddress: string, port?: number) => Promise<boolean>
  disconnectTcpDevice: (ipAddress: string, port?: number) => Promise<boolean>
  refreshDevices: () => Promise<void>
  disconnectDevice: () => void
  loadPackages: () => Promise<void>
  getUserName: () => Promise<string>
  setUserName: (name: string) => Promise<void>
}

export const AdbContext = createContext<AdbContextType | undefined>(undefined)
