import { Adb, Device as AdbKitDevice } from '@devicefarmer/adbkit'
import Tracker from '@devicefarmer/adbkit/dist/src/adb/tracker'
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import dependencyService from './dependencyService'
import fs from 'fs'

interface PackageInfo {
  packageName: string
  // More metadata fields will be added in the future
}

interface QuestDeviceProperties {
  model: string | null
  isQuestDevice: boolean
  batteryLevel: number | null
  storageTotal: string | null // e.g., "128G"
  storageFree: string | null // e.g., "50G"
  friendlyModelName: string | null
}

export type ExtendedDevice = AdbKitDevice & QuestDeviceProperties

const QUEST_MODELS = [
  'monterey',
  'hollywood',
  'seacliff',
  'eureka',
  'panther',
  'quest',
  'vr',
  'pacific',
  'sekiu'
]

// Mapping from codename (ro.product.device) to friendly name
const QUEST_MODEL_NAMES: { [key: string]: string } = {
  pacific: 'Oculus Go',
  monterey: 'Oculus Quest',
  hollywood: 'Meta Quest 2',
  seacliff: 'Meta Quest Pro',
  eureka: 'Meta Quest 3',
  panther: 'Meta Quest 3S / Lite', // Assuming based on user input
  sekiu: 'Meta XR Simulator',
  quest: 'Meta Quest (Unknown)' // Fallback for generic 'quest'
  // 'vr' doesn't map to a specific product, handled below
}

class AdbService extends EventEmitter {
  private client: ReturnType<typeof Adb.createClient> | null
  private deviceTracker: Tracker | null = null
  private isTracking = false

  constructor() {
    super()
    this.client = null
  }

  public async initialize(): Promise<void> {
    this.client = Adb.createClient({
      bin: dependencyService.getAdbPath()
    })
  }

  private async getDeviceDetails(serial: string): Promise<QuestDeviceProperties | null> {
    if (!this.client) {
      console.warn('ADB client not initialized, cannot get device details.')
      return null
    }
    const device = this.client.getDevice(serial)

    try {
      // Get product model
      const modelOutput = await device.shell('getprop ro.product.device')
      const modelResult = (await Adb.util.readAll(modelOutput)).toString().trim().toLowerCase()

      const isQuestDevice = QUEST_MODELS.includes(modelResult)
      if (!isQuestDevice) {
        console.log(
          `Device ${serial} (model: ${modelResult}) is not a Quest device. Skipping detailed fetch.`
        )
        return {
          model: modelResult,
          isQuestDevice: false,
          batteryLevel: null,
          storageTotal: null,
          storageFree: null,
          friendlyModelName: null
        }
      }

      // Determine friendly name
      const friendlyModelName =
        QUEST_MODEL_NAMES[modelResult] ||
        (modelResult === 'vr' ? 'Meta VR Device (Generic)' : `Unknown Quest (${modelResult})`)

      // Get battery level
      let batteryLevel: number | null = null
      try {
        const batteryOutput = await device.shell('dumpsys battery | grep level')
        const batteryResult = (await Adb.util.readAll(batteryOutput)).toString().trim()
        const batteryMatch = batteryResult.match(/level: (\d+)/)
        if (batteryMatch && batteryMatch[1]) {
          batteryLevel = parseInt(batteryMatch[1], 10)
        }
      } catch (batteryError) {
        console.warn(`Could not fetch battery level for ${serial}:`, batteryError)
      }

      // Get storage (df -h /data)
      // Output format is like:
      // Filesystem      Size  Used Avail Use% Mounted on
      // /dev/block/dm-5 107G   53G   55G  50% /data
      let storageTotal: string | null = null
      let storageFree: string | null = null
      try {
        const storageOutput = await device.shell('df -h /data')
        const storageResult = (await Adb.util.readAll(storageOutput)).toString().trim()
        const lines = storageResult.split('\\n')
        if (lines.length > 1) {
          const dataLine = lines[1].split(/\s+/) // Split by one or more spaces
          if (dataLine.length >= 4) {
            storageTotal = dataLine[1] // Size
            storageFree = dataLine[3] // Avail
          }
        }
      } catch (storageError) {
        console.warn(`Could not fetch storage info for ${serial}:`, storageError)
      }

      return {
        model: modelResult,
        isQuestDevice,
        batteryLevel,
        storageTotal,
        storageFree,
        friendlyModelName
      }
    } catch (error) {
      console.error(`Error getting details for device ${serial}:`, error)
      return null // Or a default object indicating failure
    }
  }

  async listDevices(): Promise<ExtendedDevice[]> {
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    try {
      const devices = await this.client.listDevices()
      const extendedDevices: ExtendedDevice[] = []

      for (const device of devices) {
        if (device.type === 'device' || device.type === 'emulator') {
          // Process only connected devices/emulators
          const details = await this.getDeviceDetails(device.id)
          if (details && details.isQuestDevice) {
            extendedDevices.push({ ...device, ...details })
          } else if (details) {
            // Optionally, you could still include non-Quest devices but mark them
            console.log(
              `Device ${device.id} (model: ${details.model}) is not a Quest device. Not adding to list.`
            )
          }
        }
      }
      return extendedDevices
    } catch (error) {
      console.error('Error listing devices:', error)
      return []
    }
  }

  async startTrackingDevices(mainWindow: BrowserWindow): Promise<void> {
    if (this.isTracking) {
      return
    }
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }

    this.isTracking = true

    this.deviceTracker = await this.client.trackDevices()

    this.deviceTracker.on('add', async (device: AdbKitDevice) => {
      console.log('Device added:', device)
      if (device.type === 'device' || device.type === 'emulator') {
        const details = await this.getDeviceDetails(device.id)
        if (details && details.isQuestDevice) {
          const extendedDevice: ExtendedDevice = { ...device, ...details }
          mainWindow.webContents.send('device-added', extendedDevice)
        } else {
          console.log(
            `Tracked device ${device.id} (model: ${details?.model}) is not a Quest device or details fetch failed. Not sending 'device-added'.`
          )
        }
      }
    })

    this.deviceTracker.on('remove', (device) => {
      console.log('Device removed:', device)
      // No need to fetch details for removal, just pass the ID
      mainWindow.webContents.send('device-removed', { id: device.id })
    })

    this.deviceTracker.on('change', async (device: AdbKitDevice) => {
      console.log('Device changed:', device)
      if (device.type === 'device' || device.type === 'emulator') {
        const details = await this.getDeviceDetails(device.id)
        if (details && details.isQuestDevice) {
          const extendedDevice: ExtendedDevice = { ...device, ...details }
          mainWindow.webContents.send('device-changed', extendedDevice)
        } else {
          console.log(
            `Tracked device ${device.id} (model: ${details?.model}) changed but is not a Quest device or details fetch failed. Not sending 'device-changed'.`
          )
          // If it was previously a Quest device and now it's not (e.g., model changed, or error), we might want to send a remove event
          // Or, ensure the frontend handles devices that might lose their "Quest" status.
          // For now, we just don't send an update if it's not a recognized Quest device.
        }
      }
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
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    try {
      // Create a device instance
      const deviceClient = this.client.getDevice(serial)

      // Test connection by getting device properties
      await deviceClient.getProperties()
      return true
    } catch (error) {
      console.error(`Error connecting to device ${serial}:`, error)
      return false
    }
  }

  async getInstalledPackages(serial: string): Promise<PackageInfo[]> {
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    try {
      const deviceClient = this.client.getDevice(serial)

      // Execute the shell command to list third-party packages
      const output = await deviceClient.shell('pm list packages -3')
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
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    try {
      const deviceClient = this.client.getDevice(serial)
      const command = `dumpsys package ${packageName} | grep versionCode`
      const output = await deviceClient.shell(command)
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

  async installPackage(serial: string, apkPath: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    console.log(`Attempting to install ${apkPath} on ${serial}...`)
    try {
      const deviceClient = this.client.getDevice(serial)
      // Use the adbkit built-in install method.
      // It handles pushing the file to a temporary location on the device first.
      // It implicitly handles replacing existing apps (like -r).
      const success = await deviceClient.install(apkPath)
      if (success) {
        console.log(`Successfully installed ${apkPath}.`)
      } else {
        // adbkit's install might not give detailed output on failure like pm install does
        console.error(`Installation of ${apkPath} reported failure by adbkit.`)
      }
      return success
    } catch (error) {
      console.error(`Error installing package ${apkPath} on device ${serial}:`, error)
      // Check for specific error codes if adbkit provides them
      if (error instanceof Error && error.message.includes('INSTALL_FAILED')) {
        console.error(`Install failed with code: ${error.message}`) // Log specific error if available
      }
      return false
    }
  }

  async runShellCommand(serial: string, command: string): Promise<string | null> {
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    console.log(`Running command on ${serial}: ${command}`)
    try {
      const deviceClient = this.client.getDevice(serial)
      const stream = await deviceClient.shell(command)
      const outputBuffer = await Adb.util.readAll(stream)
      const output = outputBuffer.toString().trim()
      console.log(`Command output: ${output}`)
      return output
    } catch (error) {
      console.error(`Error running shell command "${command}" on device ${serial}:`, error)
      return null // Indicate failure
    }
  }

  async pushFileOrFolder(serial: string, localPath: string, remotePath: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    console.log(`Pushing ${localPath} to ${serial}:${remotePath}...`)
    try {
      const deviceClient = this.client.getDevice(serial)
      const transfer = await deviceClient.push(localPath, remotePath)
      return new Promise((resolve, reject) => {
        transfer.on('end', () => {
          console.log(`Successfully pushed ${localPath} to ${remotePath}.`)
          resolve(true)
        })
        transfer.on('error', (err) => {
          console.error(`Error pushing ${localPath} to ${remotePath}:`, err)
          reject(err) // Let the promise reject on error
        })
      })
    } catch (error) {
      console.error(`Error initiating push of ${localPath} to ${serial}:${remotePath}:`, error)
      return false // Indicate failure if the push couldn't even start
    }
  }

  // Note: adbkit's pull returns a stream. This helper reads the stream and saves to a local file.
  // This implementation doesn't exist directly in adbkit, so we need fs.
  // Let's adjust the plan: pullFile might be better implemented within InstallationProcessor
  // where file system access (`fs`) is more appropriate, or we add `fs` dependency here.
  // For now, let's implement a simpler version that returns the stream,
  // or perhaps rethink if pullFile is truly needed by InstallationProcessor right now.
  // Looking back at install.txt logic, it only uses shell, install, push.
  // Standard install uses install and push.
  // Let's comment out pullFile for now as it seems unused and requires 'fs'.

  async pullFile(serial: string, remotePath: string, localPath: string): Promise<boolean> {
    // Requires 'fs' module - consider if needed or implement differently
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    console.log(`Pulling ${serial}:${remotePath} to ${localPath}...`)
    try {
      const deviceClient = this.client.getDevice(serial)
      const transfer = await deviceClient.pull(remotePath)
      console.warn(`pullFile implementation is incomplete - needs fs to save stream.`)
      const stream = fs.createWriteStream(localPath)
      await new Promise((resolve, reject) => {
        transfer.pipe(stream)
        transfer.on('end', resolve)
        transfer.on('error', reject)
      })
      console.log(`Successfully pulled ${remotePath} to ${localPath}.`)
      return false // Return false until fully implemented
    } catch (error) {
      console.error(`Error pulling ${remotePath} from ${serial}:`, error)
      return false
    }
  }

  async uninstallPackage(serial: string, packageName: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    console.log(`Attempting to uninstall ${packageName} from ${serial}...`)
    try {
      const deviceClient = this.client.getDevice(serial)

      // 1. Uninstall the package
      console.log(`Running: pm uninstall ${packageName}`)
      await deviceClient.uninstall(packageName)
      console.log(`Successfully uninstalled ${packageName}.`)

      // 2. Remove OBB directory (ignore errors)
      const obbPath = `/sdcard/Android/obb/${packageName}`
      console.log(`Running: rm -r ${obbPath} || true`)
      try {
        await deviceClient.shell(`rm -r ${obbPath}`)
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
        await deviceClient.shell(`rm -r ${dataPath}`)
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
