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

  async getPackageVersionCode(serial: string, packageName: string): Promise<number | null> {
    try {
      const device = this.client.getDevice(serial)
      const command = `dumpsys package ${packageName} | grep versionCode`
      const output = await device.shell(command)
      const result = await Adb.util.readAll(output)
      const resultString = result.toString().trim()

      // Extract the versionCode number (e.g., "    versionCode=723 minSdk=23 targetSdk=23")
      const match = resultString.match(/versionCode=(\d+)/)

      if (match && match[1]) {
        return parseInt(match[1], 10)
      }

      console.warn(`Could not find versionCode for ${packageName} in output: "${resultString}"`)
      // Check if the package was found at all
      if (resultString.includes('Unable to find package')) {
        console.warn(`Package ${packageName} not found on device ${serial} during version check.`)
      }
      return null
    } catch (error) {
      console.error(
        `Error getting version code for package ${packageName} on device ${serial}:`,
        error
      )
      // Handle specific errors like package not found if ADB command itself fails
      if (
        error instanceof Error &&
        (error.message.includes('closed') || error.message.includes('Failure'))
      ) {
        // Could indicate device disconnected or adb issue
        console.warn(`ADB command failed for ${packageName}, possibly disconnected?`)
      }
      return null
    }
  }

  async uninstallPackage(serial: string, packageName: string): Promise<boolean> {
    console.log(`Attempting to uninstall ${packageName} from ${serial}...`)
    try {
      const device = this.client.getDevice(serial)

      // 1. Uninstall the package
      console.log(`Running: pm uninstall ${packageName}`)
      await device.uninstall(packageName)
      console.log(`Successfully uninstalled ${packageName}.`)

      // 2. Remove OBB directory (ignore errors)
      const obbPath = `/sdcard/Android/obb/${packageName}`
      console.log(`Running: rm -r ${obbPath} || true`)
      try {
        await device.shell(`rm -r ${obbPath}`)
        console.log(`Successfully removed ${obbPath} (if it existed).`)
      } catch (obbError) {
        // Check if error is because the directory doesn't exist (common case)
        if (obbError instanceof Error && obbError.message.includes('No such file or directory')) {
          console.log(`OBB directory ${obbPath} did not exist.`)
        } else {
          // Log other potential errors but continue
          console.warn(`Could not remove OBB directory ${obbPath}:`, obbError)
        }
      }

      // 3. Remove Data directory (ignore errors)
      const dataPath = `/sdcard/Android/data/${packageName}`
      console.log(`Running: rm -r ${dataPath} || true`)
      try {
        await device.shell(`rm -r ${dataPath}`)
        console.log(`Successfully removed ${dataPath} (if it existed).`)
      } catch (dataError) {
        if (dataError instanceof Error && dataError.message.includes('No such file or directory')) {
          console.log(`Data directory ${dataPath} did not exist.`)
        } else {
          console.warn(`Could not remove Data directory ${dataPath}:`, dataError)
        }
      }

      console.log(`Uninstall process completed for ${packageName}.`)
      return true
    } catch (error) {
      console.error(`Error uninstalling package ${packageName} on device ${serial}:`, error)
      // Rethrow or return false based on how you want to handle errors upstream
      return false
    }
  }
}

export default new AdbService()
