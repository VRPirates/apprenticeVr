import { Adb, Device } from '@devicefarmer/adbkit'
import Tracker from '@devicefarmer/adbkit/dist/src/adb/tracker'
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'

interface PackageInfo {
  packageName: string
  // More metadata fields will be added in the future
}

class AdbService extends EventEmitter {
  private client: ReturnType<typeof Adb.createClient>
  private deviceTracker: Tracker | null = null
  private isTracking = false

  constructor() {
    super()
    this.client = Adb.createClient()
  }

  async listDevices(): Promise<Device[]> {
    try {
      const devices = await this.client.listDevices()
      return devices
    } catch (error) {
      console.error('Error listing devices:', error)
      return []
    }
  }

  async startTrackingDevices(mainWindow: BrowserWindow): Promise<void> {
    if (this.isTracking) {
      return
    }

    this.isTracking = true

    this.deviceTracker = await this.client.trackDevices()

    this.deviceTracker.on('add', (device) => {
      console.log('Device added:', device)
      mainWindow.webContents.send('device-added', device)
    })

    this.deviceTracker.on('remove', (device) => {
      console.log('Device removed:', device)
      mainWindow.webContents.send('device-removed', device)
    })

    this.deviceTracker.on('change', (device) => {
      console.log('Device changed:', device)
      mainWindow.webContents.send('device-changed', device)
    })

    this.deviceTracker.on('error', (error) => {
      console.error('Device tracker error:', error)
      mainWindow.webContents.send('device-tracker-error', error.message)
      this.stopTrackingDevices()
    })
  }

  stopTrackingDevices(): void {
    if (this.deviceTracker) {
      this.deviceTracker.end()
      this.deviceTracker = null
    }
    this.isTracking = false
  }

  async connectToDevice(serial: string): Promise<boolean> {
    try {
      // Create a device instance
      const device = this.client.getDevice(serial)

      // Test connection by getting device properties
      await device.getProperties()
      return true
    } catch (error) {
      console.error(`Error connecting to device ${serial}:`, error)
      return false
    }
  }

  async getInstalledPackages(serial: string): Promise<PackageInfo[]> {
    try {
      const device = this.client.getDevice(serial)

      // Execute the shell command to list third-party packages
      const output = await device.shell('pm list packages -3')
      const result = await Adb.util.readAll(output)

      // Convert the buffer to string and parse the packages
      const packages = result.toString().trim().split('\n')

      // Extract package names (format is "package:com.example.package")
      return packages
        .filter((line) => line.startsWith('package:'))
        .map((line) => {
          const packageName = line.substring(8).trim() // Remove "package:" prefix
          return { packageName }
        })
    } catch (error) {
      console.error(`Error getting installed packages for device ${serial}:`, error)
      return []
    }
  }
}

export default new AdbService()
