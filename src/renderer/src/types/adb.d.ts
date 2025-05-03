export interface DeviceInfo {
  id: string
  type: string
  [key: string]: unknown
}

export interface AdbAPI {
  listDevices: () => Promise<DeviceInfo[]>
  connectDevice: (serial: string) => Promise<boolean>
  startTrackingDevices: () => void
  stopTrackingDevices: () => void
  onDeviceAdded: (callback: (device: DeviceInfo) => void) => () => void
  onDeviceRemoved: (callback: (device: DeviceInfo) => void) => () => void
  onDeviceChanged: (callback: (device: DeviceInfo) => void) => () => void
  onTrackerError: (callback: (error: string) => void) => () => void
}

declare global {
  interface Window {
    api: {
      adb: AdbAPI
    }
  }
}
