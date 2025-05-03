import { AdbAPI } from './adb'

declare global {
  interface Window {
    api: {
      adb: AdbAPI
    }
    electron: {
      ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => void
        on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void
        once: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void
        removeListener: (channel: string, listener: (...args: unknown[]) => void) => void
      }
    }
  }
}
