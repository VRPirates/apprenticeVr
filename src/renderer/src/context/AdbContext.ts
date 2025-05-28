import { PackageInfo } from '@shared/types'
import { DeviceInfo } from '@shared/types'
import { createContext } from 'react'
export interface AdbContextType {
  devices: DeviceInfo[]
  selectedDevice: string | null
  selectedDeviceDetails: DeviceInfo | null
  isConnected: boolean
  isLoading: boolean
  error: string | null
  packages: PackageInfo[]
  loadingPackages: boolean
  connectToDevice: (serial: string) => Promise<boolean>
  refreshDevices: () => Promise<void>
  disconnectDevice: () => void
  loadPackages: () => Promise<void>
}

export const AdbContext = createContext<AdbContextType | undefined>(undefined)
