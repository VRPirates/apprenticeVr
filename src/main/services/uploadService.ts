import { app, BrowserWindow } from 'electron'
import { promises as fs, existsSync } from 'fs'
import { join, dirname } from 'path'
import { EventEmitter } from 'events'
import crypto from 'crypto'
import { execa } from 'execa'
import adbService from './adbService'
import dependencyService from './dependencyService'
import { ServiceStatus, UploadPreparationProgress } from '@shared/types'
import fetch from 'node-fetch'

// Enum for stages to track overall progress
enum UploadStage {
  Setup = 0,
  PullingApk = 1,
  AnalyzingObb = 2,
  PullingObb = 3,
  CreatingMetadata = 4,
  Compressing = 5,
  Uploading = 6,
  Complete = 7
}

class UploadService extends EventEmitter {
  private status: ServiceStatus = 'NOT_INITIALIZED'
  private uploadsBasePath: string
  private configFilePath: string
  private activeUpload: ReturnType<typeof execa> | null = null

  constructor() {
    super()
    this.uploadsBasePath = join(app.getPath('userData'), 'uploads')
    this.configFilePath = join(app.getPath('userData'), 'rclone-upload.conf')
  }

  public async initialize(): Promise<ServiceStatus> {
    if (this.status === 'INITIALIZED') return 'INITIALIZED'

    console.log('Initializing UploadService...')

    try {
      // Ensure upload directory exists
      await fs.mkdir(this.uploadsBasePath, { recursive: true })

      // Fetch and save rclone config for uploads
      await this.fetchRcloneConfig()

      this.status = 'INITIALIZED'
      console.log('UploadService initialized.')
      return 'INITIALIZED'
    } catch (error) {
      console.error('Failed to initialize UploadService:', error)
      this.status = 'ERROR'
      return 'ERROR'
    }
  }

  /**
   * Fetch and save the VRPirates upload rclone config file
   */
  private async fetchRcloneConfig(): Promise<void> {
    const configUrl = 'https://vrpirates.wiki/downloads/vrp.upload.config'

    try {
      console.log(`Fetching rclone upload config from: ${configUrl}`)
      const response = await fetch(configUrl)

      if (!response.ok) {
        throw new Error(`Failed to fetch rclone config: ${response.status} ${response.statusText}`)
      }

      const configData = await response.text()

      if (!configData.includes('[RSL-gameuploads]')) {
        throw new Error('Invalid rclone config: missing RSL-gameuploads section')
      }

      await fs.writeFile(this.configFilePath, configData, 'utf-8')
      console.log(`Rclone upload config saved to: ${this.configFilePath}`)
    } catch (error) {
      console.error('Error fetching rclone upload config:', error)
      throw error
    }
  }

  /**
   * Create a SHA256 hash from the device serial
   * This creates a unique but reproducible ID for the device
   */
  private generateHWID(deviceSerial: string): string {
    return crypto.createHash('sha256').update(deviceSerial).digest('hex')
  }

  private emitProgress(packageName: string, stage: string, progress: number): void {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      const progressData: UploadPreparationProgress = {
        packageName,
        stage,
        progress
      }
      mainWindow.webContents.send('upload:progress', progressData)
    }
  }

  /**
   * Calculate and emit the overall progress
   * Each stage has its own 0-100 progress which we scale to the overall process
   */
  private updateProgress(packageName: string, stage: UploadStage, stageProgress: number): void {
    // Map stage to a descriptive name
    let stageName = 'Preparing upload'
    switch (stage) {
      case UploadStage.Setup:
        stageName = 'Setting up'
        break
      case UploadStage.PullingApk:
        stageName = 'Pulling APK'
        break
      case UploadStage.AnalyzingObb:
        stageName = 'Analyzing OBB content'
        break
      case UploadStage.PullingObb:
        stageName = 'Pulling OBB files'
        break
      case UploadStage.CreatingMetadata:
        stageName = 'Creating metadata'
        break
      case UploadStage.Compressing:
        stageName = 'Creating zip archive'
        break
      case UploadStage.Uploading:
        stageName = 'Uploading to VRPirates'
        break
      case UploadStage.Complete:
        stageName = 'Complete'
        break
    }

    this.emitProgress(packageName, stageName, stageProgress)
  }

  public async prepareUpload(
    packageName: string,
    gameName: string,
    versionCode: number,
    deviceId: string
  ): Promise<string | null> {
    if (this.status !== 'INITIALIZED') {
      throw new Error('UploadService is not initialized')
    }

    try {
      // --- SETUP STAGE ---
      this.updateProgress(packageName, UploadStage.Setup, 0)

      // Get device info
      const devicesList = await adbService.listDevices()
      const deviceInfo = devicesList.find((d) => d.id === deviceId)

      if (!deviceInfo) {
        throw new Error(`Device with ID ${deviceId} not found or not connected`)
      }

      // Use model as device codename
      const deviceCodename = deviceInfo.model || 'unknown'

      // Generate HWID
      const hwid = this.generateHWID(deviceId)
      const hwidPrefix = hwid.substring(0, 1)

      // Create folder path for the app
      const packageFolderName = packageName
      const packageFolderPath = join(this.uploadsBasePath, packageFolderName)

      // Clean up any existing folder
      if (existsSync(packageFolderPath)) {
        await fs.rm(packageFolderPath, { recursive: true, force: true })
      }

      // Create the app folder
      await fs.mkdir(packageFolderPath, { recursive: true })
      this.updateProgress(packageName, UploadStage.Setup, 100)

      // --- PULLING APK STAGE ---
      this.updateProgress(packageName, UploadStage.PullingApk, 0)

      // Get the path to the APK on the device
      const shellCmd = `pm path ${packageName}`
      const apkPathOutput = await adbService.runShellCommand(deviceId, shellCmd)

      if (!apkPathOutput || !apkPathOutput.includes('package:')) {
        throw new Error(`Could not find APK for ${packageName} on device`)
      }

      // Extract the APK path from the output
      const apkPath = apkPathOutput.trim().split('\n')[0].replace('package:', '')
      const apkFileName = `${packageName}.apk`
      const localApkPath = join(packageFolderPath, apkFileName)

      // Pull the APK file
      this.updateProgress(packageName, UploadStage.PullingApk, 50)
      console.log(`Pulling APK from ${apkPath} to ${localApkPath}...`)
      await adbService.pullFile(deviceId, apkPath, localApkPath)
      this.updateProgress(packageName, UploadStage.PullingApk, 100)

      // --- ANALYZING OBB STAGE ---
      this.updateProgress(packageName, UploadStage.AnalyzingObb, 0)

      // Check if OBB folder exists
      const obbFolderPath = `/sdcard/Android/obb/${packageName}`
      const obbCheckCmd = `[ -d "${obbFolderPath}" ] && echo "EXISTS" || echo ""`
      const obbExists = await adbService.runShellCommand(deviceId, obbCheckCmd)
      this.updateProgress(packageName, UploadStage.AnalyzingObb, 50)

      // --- PULLING OBB STAGE ---
      this.updateProgress(packageName, UploadStage.PullingObb, 0)

      // Pull OBB folder if it exists
      if (obbExists && obbExists.includes('EXISTS')) {
        console.log(`OBB folder found for ${packageName}, analyzing contents...`)

        // Create the main OBB folder locally
        const localObbFolder = join(packageFolderPath, packageFolderName)
        await fs.mkdir(localObbFolder, { recursive: true })

        // List all files in the OBB folder recursively with their sizes
        const listFilesCmd = `find "${obbFolderPath}" -type f -printf "%s %p\\n"`
        const filesListOutput = await adbService.runShellCommand(deviceId, listFilesCmd)
        this.updateProgress(packageName, UploadStage.AnalyzingObb, 100)

        if (!filesListOutput || !filesListOutput.trim()) {
          console.log(`No files found in OBB folder for ${packageName}`)
          this.updateProgress(packageName, UploadStage.PullingObb, 100)
        } else {
          // Parse the output to get files with their sizes
          const fileEntries = filesListOutput
            .trim()
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => {
              const match = line.match(/^(\d+)\s+(.+)$/)
              if (match) {
                return {
                  size: parseInt(match[1], 10),
                  path: match[2]
                }
              }
              return null
            })
            .filter((entry) => entry !== null) as { size: number; path: string }[]

          const totalSize = fileEntries.reduce((sum, entry) => sum + entry.size, 0)
          let downloadedSize = 0

          console.log(
            `Found ${fileEntries.length} files in OBB folder, total size: ${totalSize} bytes`
          )

          // Pull each file one by one, maintaining directory structure
          for (let i = 0; i < fileEntries.length; i++) {
            const { path: remotePath, size } = fileEntries[i]

            // Create relative path from OBB folder root
            const relPath = remotePath.substring(obbFolderPath.length + 1) // +1 for the slash
            const localPath = join(localObbFolder, relPath)

            // Ensure parent directory exists
            const parentDir = dirname(localPath)
            await fs.mkdir(parentDir, { recursive: true })

            console.log(
              `Pulling file ${i + 1}/${fileEntries.length}: ${remotePath} (${size} bytes)`
            )
            await adbService.pullFile(deviceId, remotePath, localPath)

            // Update progress
            downloadedSize += size
            const progressPercentage = Math.min(Math.floor((downloadedSize / totalSize) * 100), 100)
            this.updateProgress(packageName, UploadStage.PullingObb, progressPercentage)
          }

          console.log(`Successfully pulled all OBB files for ${packageName}`)
        }
      } else {
        console.log(`No OBB folder found for ${packageName}`)
        this.updateProgress(packageName, UploadStage.PullingObb, 100)
      }

      // --- CREATING METADATA STAGE ---
      this.updateProgress(packageName, UploadStage.CreatingMetadata, 0)

      // Create uploadMethod.txt file
      await fs.writeFile(join(packageFolderPath, 'uploadMethod.txt'), 'manual', 'utf-8')
      this.updateProgress(packageName, UploadStage.CreatingMetadata, 50)

      // Create HWID.txt file
      await fs.writeFile(join(packageFolderPath, 'HWID.txt'), hwid, 'utf-8')
      this.updateProgress(packageName, UploadStage.CreatingMetadata, 100)

      // --- COMPRESSING STAGE ---
      this.updateProgress(packageName, UploadStage.Compressing, 0)

      // Create the zip file
      const zipFileName = `${gameName} v${versionCode} ${packageName} ${hwidPrefix} ${deviceCodename}.zip`
      const zipFilePath = join(this.uploadsBasePath, zipFileName)

      // Delete existing zip file if it exists
      if (existsSync(zipFilePath)) {
        await fs.unlink(zipFilePath)
      }

      // Compress the folder using 7zip
      const sevenZipPath = dependencyService.get7zPath()
      if (!sevenZipPath) {
        throw new Error('7zip not found. Cannot create zip archive.')
      }

      console.log(`Creating zip archive at ${zipFilePath}...`)

      const compression = execa(sevenZipPath, ['a', zipFilePath, '.', '-bsp1'], {
        cwd: packageFolderPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        all: true,
        buffer: false,
        windowsHide: true
      })

      if (!compression.all || !compression.stdout || !compression.stderr) {
        throw new Error('Could not capture compression output streams')
      }

      // Set up progress tracking
      let lastProgress = 0

      compression.stdout?.setEncoding('utf8')
      // Listen to stdout for progress updates (this is where 7zip writes progress)
      compression.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split(/\r?\n/)
        for (const line of lines) {
          const matches = line.matchAll(/(\d{1,3})%/g)
          for (const match of matches) {
            const percent = parseInt(match[1], 10)
            if (!isNaN(percent) && percent > lastProgress) {
              lastProgress = percent
              console.log(`[Compression progress]: ${percent}%`)
              this.updateProgress(packageName, UploadStage.Compressing, percent)
            }
          }
        }
      })

      // Listen to stderr for errors
      compression.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString()
        console.log(`[7zip stderr]: ${chunk}`)

        // Check for error messages
        if (chunk.includes('ERROR:')) {
          console.error(`[UploadService] Compression error: ${chunk}`)
        }
      })

      // Wait for the compression to complete
      await compression

      this.updateProgress(packageName, UploadStage.Compressing, 100)

      await fs.rm(packageFolderPath, { recursive: true, force: true })

      // --- UPLOADING STAGE ---
      this.updateProgress(packageName, UploadStage.Uploading, 0)

      // Check if the generated zip file exists
      if (!existsSync(zipFilePath)) {
        throw new Error(`Zip file not found: ${zipFilePath}`)
      }

      try {
        // Upload the zip file to VRPirates
        const uploadSuccess = await this.uploadToVRPirates(packageName, gameName, zipFilePath)

        if (!uploadSuccess) {
          throw new Error('Failed to upload to VRPirates')
        }

        this.updateProgress(packageName, UploadStage.Uploading, 100)
      } catch (uploadError) {
        console.error(`Error uploading ${zipFilePath} to VRPirates:`, uploadError)
        throw uploadError
      }

      // --- COMPLETE STAGE ---
      this.updateProgress(packageName, UploadStage.Complete, 100)
      console.log(`Upload completed: ${zipFilePath}`)

      return zipFilePath
    } catch (error) {
      console.error(`Error preparing upload for ${packageName}:`, error)
      this.emitProgress(packageName, 'Error', 0)
      return null
    }
  }

  /**
   * Uploads the zip file to VRPirates using rclone
   * @param zipFilePath Path to the zip file to upload
   * @returns true if upload was successful, false otherwise
   */
  private async uploadToVRPirates(
    packageName: string,
    gameName: string,
    zipFilePath: string
  ): Promise<boolean> {
    console.log(`[UploadService] Starting upload of ${zipFilePath} to VRPirates`)

    if (!existsSync(this.configFilePath)) {
      console.error(`[UploadService] Rclone config file not found: ${this.configFilePath}`)
      throw new Error('Rclone config file not found')
    }

    const rclonePath = dependencyService.getRclonePath()
    if (!rclonePath) {
      console.error('[UploadService] Rclone path not found.')
      throw new Error('Rclone dependency not found')
    }

    try {
      // Get file stats
      const stats = await fs.stat(zipFilePath)
      const fileSize = stats.size

      // Create a text file with the file size
      const sizeFilePath = join(this.uploadsBasePath, `${gameName}.txt`)
      await fs.writeFile(sizeFilePath, `${fileSize}`, 'utf-8')

      console.log(`[UploadService] Created size file at ${sizeFilePath} with content: ${fileSize}`)

      // First upload the size file
      console.log(`[UploadService] Uploading size file: ${sizeFilePath}`)

      await execa(rclonePath, [
        'copy',
        sizeFilePath,
        'RSL-gameuploads:',
        '--config',
        this.configFilePath,
        '--checkers',
        '1',
        '--retries',
        '2',
        '--inplace'
      ])

      console.log(`[UploadService] Size file uploaded successfully`)

      // Now upload the actual zip file with progress tracking
      console.log(`[UploadService] Starting upload of zip file: ${zipFilePath}`)

      this.activeUpload = execa(
        rclonePath,
        [
          'copy',
          zipFilePath,
          'RSL-gameuploads:',
          '--config',
          this.configFilePath,
          '--checkers',
          '1',
          '--retries',
          '2',
          '--inplace',
          '--progress',
          '--stats',
          '1s',
          '--stats-one-line'
        ],
        {
          all: true,
          buffer: false,
          windowsHide: true
        }
      )

      if (!this.activeUpload || !this.activeUpload.all) {
        throw new Error('Failed to start rclone upload process')
      }

      // Parse progress from rclone output
      const transferRegex = /(\d+)%/

      this.activeUpload.all.on('data', (data: Buffer) => {
        const output = data.toString()
        console.log(`[Upload Output] ${output}`)

        // Look for percentage in the output
        const lines = output.split('\n')
        for (const line of lines) {
          const matches = line.match(transferRegex)
          if (matches && matches[1]) {
            const progress = parseInt(matches[1], 10)
            if (!isNaN(progress)) {
              this.updateProgress(packageName, UploadStage.Uploading, progress)
            }
          }
        }
      })

      // Wait for the upload to complete
      await this.activeUpload

      console.log(`[UploadService] Zip file uploaded successfully`)

      // Clean up the size file
      try {
        await fs.unlink(sizeFilePath)
      } catch (error) {
        console.warn(`[UploadService] Failed to delete size file: ${sizeFilePath}`, error)
        // Non-critical error, continue
      }

      this.activeUpload = null
      return true
    } catch (error) {
      console.error(`[UploadService] Error uploading to VRPirates:`, error)
      if (this.activeUpload) {
        try {
          this.activeUpload.kill('SIGTERM')
        } catch (killError) {
          console.warn(`[UploadService] Error killing active upload:`, killError)
        }
        this.activeUpload = null
      }
      throw error
    }
  }

  /**
   * Cancel the active upload if one is in progress
   */
  public cancelUpload(packageName: string): void {
    if (this.activeUpload) {
      console.log(`[UploadService] Cancelling active upload`)
      try {
        this.activeUpload.kill('SIGTERM')
        this.activeUpload = null
        this.emitProgress(packageName, 'Cancelled', 0)
      } catch (error) {
        console.error(`[UploadService] Error cancelling upload:`, error)
      }
    } else {
      console.log(`[UploadService] No active upload to cancel`)
    }
  }
}

export default new UploadService()
