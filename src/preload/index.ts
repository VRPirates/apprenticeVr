import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Define device info interface
interface DeviceInfo {
  id: string
  type: string
  [key: string]: unknown
}

// Custom APIs for renderer
const api = {
  adb: {
    listDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke('list-devices'),
    connectDevice: (serial: string): Promise<boolean> =>
      ipcRenderer.invoke('connect-device', serial),
    startTrackingDevices: (): void => ipcRenderer.send('start-tracking-devices'),
    stopTrackingDevices: (): void => ipcRenderer.send('stop-tracking-devices'),
    onDeviceAdded: (callback: (device: DeviceInfo) => void): (() => void) => {
      const listener = (_: unknown, device: DeviceInfo): void => callback(device)
      ipcRenderer.on('device-added', listener)
      return () => ipcRenderer.removeListener('device-added', listener)
    },
    onDeviceRemoved: (callback: (device: DeviceInfo) => void): (() => void) => {
      const listener = (_: unknown, device: DeviceInfo): void => callback(device)
      ipcRenderer.on('device-removed', listener)
      return () => ipcRenderer.removeListener('device-removed', listener)
    },
    onDeviceChanged: (callback: (device: DeviceInfo) => void): (() => void) => {
      const listener = (_: unknown, device: DeviceInfo): void => callback(device)
      ipcRenderer.on('device-changed', listener)
      return () => ipcRenderer.removeListener('device-changed', listener)
    },
    onTrackerError: (callback: (error: string) => void): (() => void) => {
      const listener = (_: unknown, error: string): void => callback(error)
      ipcRenderer.on('device-tracker-error', listener)
      return () => ipcRenderer.removeListener('device-tracker-error', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
