import { app, BrowserWindow } from 'electron'
import { promises as fs, existsSync } from 'fs'
import { join, dirname } from 'path'
import { EventEmitter } from 'events'
import crypto from 'crypto'
import { execa } from 'execa'
import adbService from './adbService'
import dependencyService from './dependencyService'
import { ServiceStatus, UploadPreparationProgress } from '@shared/types'

// Enum for stages to track overall progress
enum UploadStage {
  Setup = 0,
  PullingApk = 1,
  AnalyzingObb = 2,
  PullingObb = 3,
  CreatingMetadata = 4,
  Compressing = 5,
  Complete = 6
}

class UploadService extends EventEmitter {
  private status: ServiceStatus = 'NOT_INITIALIZED'
  private uploadsBasePath: string

  constructor() {
    super()
    this.uploadsBasePath = join(app.getPath('userData'), 'uploads')
  }

  public async initialize(): Promise<ServiceStatus> {
    if (this.status === 'INITIALIZED') return 'INITIALIZED'

    console.log('Initializing UploadService...')

    try {
      // Ensure upload directory exists
      await fs.mkdir(this.uploadsBasePath, { recursive: true })

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
   * Create a SHA256 hash from the device serial
   * This creates a unique but reproducible ID for the device
   */
  private generateHWID(deviceSerial: string): string {
    return crypto.createHash('sha256').update(deviceSerial).digest('hex')
  }

  private emitProgress(stage: string, progress: number): void {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      const progressData: UploadPreparationProgress = {
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
  private updateProgress(stage: UploadStage, stageProgress: number): void {
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
      case UploadStage.Complete:
        stageName = 'Complete'
        break
    }

    this.emitProgress(stageName, stageProgress)
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
      this.updateProgress(UploadStage.Setup, 0)

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
      this.updateProgress(UploadStage.Setup, 100)

      // --- PULLING APK STAGE ---
      this.updateProgress(UploadStage.PullingApk, 0)

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
      this.updateProgress(UploadStage.PullingApk, 50)
      console.log(`Pulling APK from ${apkPath} to ${localApkPath}...`)
      await adbService.pullFile(deviceId, apkPath, localApkPath)
      this.updateProgress(UploadStage.PullingApk, 100)

      // --- ANALYZING OBB STAGE ---
      this.updateProgress(UploadStage.AnalyzingObb, 0)

      // Check if OBB folder exists
      const obbFolderPath = `/sdcard/Android/obb/${packageName}`
      const obbCheckCmd = `[ -d "${obbFolderPath}" ] && echo "EXISTS" || echo ""`
      const obbExists = await adbService.runShellCommand(deviceId, obbCheckCmd)
      this.updateProgress(UploadStage.AnalyzingObb, 50)

      // --- PULLING OBB STAGE ---
      this.updateProgress(UploadStage.PullingObb, 0)

      // Pull OBB folder if it exists
      if (obbExists && obbExists.includes('EXISTS')) {
        console.log(`OBB folder found for ${packageName}, analyzing contents...`)

        // Create the main OBB folder locally
        const localObbFolder = join(packageFolderPath, packageFolderName)
        await fs.mkdir(localObbFolder, { recursive: true })

        // List all files in the OBB folder recursively with their sizes
        const listFilesCmd = `find "${obbFolderPath}" -type f -printf "%s %p\\n"`
        const filesListOutput = await adbService.runShellCommand(deviceId, listFilesCmd)
        this.updateProgress(UploadStage.AnalyzingObb, 100)

        if (!filesListOutput || !filesListOutput.trim()) {
          console.log(`No files found in OBB folder for ${packageName}`)
          this.updateProgress(UploadStage.PullingObb, 100)
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
            this.updateProgress(UploadStage.PullingObb, progressPercentage)
          }

          console.log(`Successfully pulled all OBB files for ${packageName}`)
        }
      } else {
        console.log(`No OBB folder found for ${packageName}`)
        this.updateProgress(UploadStage.PullingObb, 100)
      }

      // --- CREATING METADATA STAGE ---
      this.updateProgress(UploadStage.CreatingMetadata, 0)

      // Create uploadMethod.txt file
      await fs.writeFile(join(packageFolderPath, 'uploadMethod.txt'), 'manual', 'utf-8')
      this.updateProgress(UploadStage.CreatingMetadata, 50)

      // Create HWID.txt file
      await fs.writeFile(join(packageFolderPath, 'HWID.txt'), hwid, 'utf-8')
      this.updateProgress(UploadStage.CreatingMetadata, 100)

      // --- COMPRESSING STAGE ---
      this.updateProgress(UploadStage.Compressing, 0)

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

      // Use the same approach as in extractionProcessor to track progress
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

      // Add timestamps to debug logs
      const now = (): string => new Date().toISOString().substring(11, 23)
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
              console.log(`[Compression progress ${now()}]: ${percent}%`)
              this.updateProgress(UploadStage.Compressing, percent)
            }
          }
        }
      })

      // Listen to stderr for errors
      compression.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString()
        console.log(`[7zip stderr ${now()}]: ${chunk}`)

        // Check for error messages
        if (chunk.includes('ERROR:')) {
          console.error(`[UploadService] Compression error: ${chunk}`)
        }
      })

      // Wait for the compression to complete
      await compression

      this.updateProgress(UploadStage.Compressing, 100)

      await fs.rm(packageFolderPath, { recursive: true, force: true })

      // --- COMPLETE STAGE ---
      this.updateProgress(UploadStage.Complete, 100)
      console.log(`Upload preparation completed: ${zipFilePath}`)

      return zipFilePath
    } catch (error) {
      console.error(`Error preparing upload for ${packageName}:`, error)
      this.emitProgress('Error', 0)
      return null
    }
  }
}

export default new UploadService()
