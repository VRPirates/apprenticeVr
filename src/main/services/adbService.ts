import { Adb, Device as AdbKitDevice, DeviceClient } from '@devicefarmer/adbkit'
import Tracker from '@devicefarmer/adbkit/dist/src/adb/tracker'
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import dependencyService from './dependencyService'
import fs from 'fs'
import path from 'path'

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
        const lines = storageResult.split('\n')
        if (lines.length > 1) {
          const dataLine = lines[1].split(/\s+/)
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

  async installPackage(
    serial: string,
    apkPath: string,
    options?: { flags?: string[] }
  ): Promise<boolean> {
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }
    console.log(
      `Attempting to install ${apkPath} on ${serial}${options?.flags ? ` with flags: ${options.flags.join(' ')}` : ''}...`
    )
    const deviceClient = this.client.getDevice(serial)

    if (options?.flags && options.flags.length > 0) {
      const apkFileName = path.basename(apkPath)
      const remoteTempApkPath = `/data/local/tmp/${apkFileName}`

      try {
        // 1. Push APK to temporary location
        console.log(`[ADB Service] Pushing ${apkPath} to ${remoteTempApkPath}...`)
        const pushTransfer = await deviceClient.push(apkPath, remoteTempApkPath)
        await new Promise<void>((resolve, reject) => {
          pushTransfer.on('end', resolve)
          pushTransfer.on('error', (err: Error) => {
            console.error(
              `[ADB Service] Error pushing APK ${apkPath} to ${remoteTempApkPath}:`,
              err
            )
            reject(err)
          })
        })
        console.log(`[ADB Service] Successfully pushed ${apkPath} to ${remoteTempApkPath}.`)

        // 2. Construct and execute pm install command
        const installCommand = `pm install ${options.flags.join(' ')} "${remoteTempApkPath}"`
        console.log(`[ADB Service] Running install command: ${installCommand}`)
        let output = await this.runShellCommand(serial, installCommand) // runShellCommand already logs

        // Check for INSTALL_FAILED_UPDATE_INCOMPATIBLE and attempt uninstall then retry
        if (output?.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE')) {
          console.warn(
            `[ADB Service] Install failed due to incompatible update. Attempting uninstall and retry. Original error: ${output}`
          )
          const packageNameMatch = output.match(/Package ([a-zA-Z0-9_.]+)/)
          if (packageNameMatch && packageNameMatch[1]) {
            const packageName = packageNameMatch[1]
            console.log(`[ADB Service] Extracted package name for uninstall: ${packageName}`)
            const uninstallSuccess = await this.uninstallPackage(serial, packageName)
            if (uninstallSuccess) {
              console.log(
                `[ADB Service] Successfully uninstalled ${packageName}. Retrying installation...`
              )
              output = await this.runShellCommand(serial, installCommand) // Retry install
            } else {
              console.error(
                `[ADB Service] Failed to uninstall ${packageName}. Installation will likely still fail.`
              )
            }
          } else {
            console.warn(
              '[ADB Service] Could not extract package name from incompatibility error. Cannot attempt uninstall.'
            )
          }
        }

        // 3. Clean up temporary APK
        console.log(`[ADB Service] Cleaning up temporary APK: ${remoteTempApkPath}`)
        const cleanupOutput = await this.runShellCommand(serial, `rm -f "${remoteTempApkPath}"`)
        if (cleanupOutput === null || !cleanupOutput.includes('No such file or directory')) {
          // Consider logging if rm -f didn't behave as expected (e.g. permission errors other than file not found)
          if (cleanupOutput !== null && cleanupOutput.trim() !== '') {
            console.warn(
              `[ADB Service] Output during cleanup of ${remoteTempApkPath}: ${cleanupOutput}`
            )
          } else if (cleanupOutput === null) {
            console.warn(
              `[ADB Service] Failed to execute cleanup command for ${remoteTempApkPath} or no output.`
            )
          }
        }

        if (output?.includes('Success')) {
          console.log(`Successfully installed ${apkPath} with flags. Output: ${output}`)
          return true
        } else {
          console.error(
            `Installation of ${apkPath} with flags failed or success not confirmed. Output: ${output || 'No output'}`
          )
          // Attempt to extract common failure reasons
          if (output?.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE')) {
            console.error(
              'Detailed error: INSTALL_FAILED_UPDATE_INCOMPATIBLE. Signatures might still mismatch or other issue.'
            )
          } else if (output?.includes('INSTALL_FAILED_VERSION_DOWNGRADE')) {
            console.error(
              'Detailed error: INSTALL_FAILED_VERSION_DOWNGRADE. Cannot downgrade versions with these flags.'
            )
          } else if (output?.includes('INSTALL_FAILED_ALREADY_EXISTS')) {
            console.error('Detailed error: INSTALL_FAILED_ALREADY_EXISTS. Package already exists.')
          }
          return false
        }
      } catch (error) {
        console.error(
          `[ADB Service] Error during flagged installation of ${apkPath} on device ${serial}:`,
          error
        )
        // Ensure cleanup is attempted even if earlier steps fail
        try {
          console.log(`[ADB Service] Attempting cleanup of ${remoteTempApkPath} after error...`)
          await this.runShellCommand(serial, `rm -f "${remoteTempApkPath}"`)
        } catch (cleanupError) {
          console.error(
            `[ADB Service] Error during cleanup of ${remoteTempApkPath} after initial error:`,
            cleanupError
          )
        }
        return false
      }
    } else {
      // Original logic for installation without flags
      try {
        const success = await deviceClient.install(apkPath)
        if (success) {
          console.log(`Successfully installed ${apkPath} using adbkit.install.`)
        } else {
          console.error(`Installation of ${apkPath} reported failure by adbkit.install.`)
        }
        return success
      } catch (error) {
        console.error(
          `Error installing package ${apkPath} on device ${serial} (adbkit.install):`,
          error
        )
        if (error instanceof Error && error.message.includes('INSTALL_FAILED')) {
          console.error(`Install failed with code: ${error.message}`)
        }
        return false
      }
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

  private async _pushDirectoryRecursive(
    serial: string,
    localDirPath: string,
    remoteDirPath: string,
    deviceClient: DeviceClient
  ): Promise<boolean> {
    // 1. Create the remote directory
    try {
      console.log(`[AdbService Recursive] Ensuring remote directory exists: ${remoteDirPath}`)
      const mkdirOutput = await this.runShellCommand(serial, `mkdir -p "${remoteDirPath}"`)
      if (mkdirOutput === null) {
        // runShellCommand logs errors and returns null on failure
        console.error(
          `[AdbService Recursive] Failed to create remote directory ${remoteDirPath} (runShellCommand indicated failure).`
        )
        return false
      }
    } catch (error) {
      // This catch block is for unexpected errors from runShellCommand itself, though it's designed to catch its own.
      console.error(
        `[AdbService Recursive] Exception while creating remote directory ${remoteDirPath}:`,
        error
      )
      return false
    }

    // 2. Read entries in localDirPath
    let entries
    try {
      entries = await fs.promises.readdir(localDirPath, { withFileTypes: true })
    } catch (readDirError) {
      console.error(
        `[AdbService Recursive] Failed to read local directory ${localDirPath}:`,
        readDirError
      )
      return false
    }

    // 3. For each entry
    for (const entry of entries) {
      const localEntryPath = path.join(localDirPath, entry.name)
      const remoteEntryPath = path.join(remoteDirPath, entry.name) // Full path for the entry on device

      if (entry.isFile()) {
        console.log(
          `[AdbService Recursive] Pushing file ${localEntryPath} to ${serial}:${remoteEntryPath}`
        )
        try {
          const transfer = await deviceClient.push(localEntryPath, remoteEntryPath)
          const filePushSuccess = await new Promise<boolean>((resolve) => {
            transfer.on('end', () => resolve(true))
            transfer.on('error', (err: Error) => {
              console.error(
                `[AdbService Recursive] Error pushing file ${localEntryPath} to ${remoteEntryPath}:`,
                err
              )
              resolve(false)
            })
          })

          if (!filePushSuccess) {
            console.error(
              `[AdbService Recursive] Failed to push file ${localEntryPath}. Aborting directory push.`
            )
            return false // Stop if any file fails
          }
        } catch (filePushError) {
          console.error(
            `[AdbService Recursive] Exception during push of file ${localEntryPath}:`,
            filePushError
          )
          return false
        }
      } else if (entry.isDirectory()) {
        console.log(
          `[AdbService Recursive] Pushing directory ${localEntryPath} to ${serial}:${remoteEntryPath}`
        )
        const subdirPushSuccess = await this._pushDirectoryRecursive(
          serial,
          localEntryPath,
          remoteEntryPath,
          deviceClient
        )
        if (!subdirPushSuccess) {
          console.error(
            `[AdbService Recursive] Failed to push subdirectory ${localEntryPath}. Aborting directory push.`
          )
          return false // Stop if any subdirectory fails
        }
      }
    }
    return true // All entries processed successfully
  }

  async pushFileOrFolder(serial: string, localPath: string, remotePath: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('adb service not initialized!')
    }

    let finalRemotePath = remotePath // Will be determined in the try block

    try {
      const localStat = await fs.promises.stat(localPath)

      // Determine the final remote path based on whether it's a file or directory
      // and if the remote path needs basename appending.
      if (localStat.isFile()) {
        if (remotePath.endsWith('/')) {
          finalRemotePath = path.join(remotePath, path.basename(localPath))
        }
        // If localPath is a file and remotePath does not end with '/',
        // remotePath is assumed to be the full target file path.
      } else if (localStat.isDirectory()) {
        if (remotePath.endsWith('/')) {
          // e.g., localPath="dir", remotePath="/sdcard/" => finalRemotePath="/sdcard/dir"
          finalRemotePath = path.join(remotePath, path.basename(localPath))
        }
        // If remotePath does not end with a slash (e.g., "/sdcard/targetdir"),
        // it's assumed to be the explicit full path for the target directory.
        // finalRemotePath is already correctly set by assignment from remotePath.
      }

      const deviceClient = this.client.getDevice(serial)

      if (localStat.isDirectory()) {
        console.log(
          `[AdbService] Pushing directory ${localPath} to ${serial}:${finalRemotePath} using recursive method.`
        )
        return await this._pushDirectoryRecursive(serial, localPath, finalRemotePath, deviceClient)
      } else {
        // It's a file
        console.log(
          `Pushing file ${localPath} to ${serial}:${finalRemotePath}... (original remote: ${remotePath})`
        )
        const transfer = await deviceClient.push(localPath, finalRemotePath)
        return new Promise<boolean>((resolve, reject) => {
          transfer.on('end', () => {
            console.log(`Successfully pushed file ${localPath} to ${finalRemotePath}.`)
            resolve(true)
          })
          transfer.on('error', (err) => {
            console.error(`Error pushing file ${localPath} to ${finalRemotePath}:`, err)
            reject(err) // This will be caught by the outer catch block
          })
        })
      }
    } catch (error: unknown) {
      // Handle errors from fs.promises.stat or rejections from file push
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'ENOENT'
      ) {
        console.error(
          `[AdbService] Local file/folder not found for push: ${localPath}. Code: ${(error as { code: string }).code}`
        )
      } else {
        console.error(
          `[AdbService] Error during push operation for ${localPath} to ${serial}:${finalRemotePath} (original remote: ${remotePath}):`,
          error
        )
      }
      return false
    }
  }

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
