import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { execa, ExecaError } from 'execa'
import { GameInfo } from './gameService'
import { DownloadItem, DownloadStatus } from './downloadTypes'
import dependencyService from './dependencyService'
import { EventEmitter } from 'events'
import crypto from 'crypto'
// Debounce function with improved typing
function debounce<T extends (...args: P) => void, P extends unknown[]>(
  func: T,
  wait: number
): (...args: P) => void {
  let timeout: NodeJS.Timeout | null = null
  return (...args: P): void => {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => {
      func(...args)
    }, wait)
  }
}

class DownloadService extends EventEmitter {
  private queue: DownloadItem[] = []
  private queuePath: string
  private downloadsDir: string
  private isInitialized = false
  private isProcessing = false
  private activeDownloads: Map<string, ReturnType<typeof execa>> = new Map()
  private activeExtractions: Map<string, ReturnType<typeof execa>> = new Map()
  private vrpConfig: { baseUri?: string; password?: string } | null = null
  private debouncedSaveQueue: () => void
  private debouncedEmitUpdate: () => void

  constructor() {
    super()
    this.queuePath = join(app.getPath('userData'), 'download-queue.json')
    this.downloadsDir = join(app.getPath('userData'), 'downloads')
    this.debouncedSaveQueue = debounce(this.saveQueue.bind(this), 1000)
    this.debouncedEmitUpdate = debounce(this.emitUpdate.bind(this), 300)
  }

  async initialize(vrpConfig: { baseUri?: string; password?: string } | null): Promise<void> {
    if (this.isInitialized) return
    console.log('Initializing DownloadService...')
    this.vrpConfig = vrpConfig
    await fs.mkdir(this.downloadsDir, { recursive: true })
    await this.loadQueue()

    let changed = false
    this.queue.forEach((item) => {
      if (item.status === 'Downloading') {
        console.log(`Resetting status for ${item.releaseName} from Downloading to Queued.`)
        item.status = 'Queued'
        item.pid = undefined
        item.progress = 0
        changed = true
      }
    })
    if (changed) {
      this.debouncedSaveQueue()
    }

    this.isInitialized = true
    console.log('DownloadService initialized.')
    this.emitUpdate()
    this.processQueue()
  }

  private async loadQueue(): Promise<void> {
    try {
      if (existsSync(this.queuePath)) {
        const data = await fs.readFile(this.queuePath, 'utf-8')
        this.queue = JSON.parse(data)
        if (!Array.isArray(this.queue)) {
          console.warn('Loaded download queue is not an array, resetting.')
          this.queue = []
        }
        console.log(`Loaded ${this.queue.length} items from download queue.`)
      } else {
        console.log('No existing download queue found.')
        this.queue = []
      }
    } catch (error) {
      console.error('Error loading download queue:', error)
      this.queue = []
    }
  }

  private async saveQueue(): Promise<void> {
    try {
      await fs.writeFile(this.queuePath, JSON.stringify(this.queue, null, 2), 'utf-8')
    } catch (error) {
      console.error('Error saving download queue:', error)
    }
  }

  public getQueue(): DownloadItem[] {
    return [...this.queue]
  }

  public addToQueue(game: GameInfo): boolean {
    if (!this.isInitialized) {
      console.error('DownloadService not initialized. Cannot add to queue.')
      return false
    }
    if (!game.releaseName) {
      console.error(`Cannot add game ${game.name} to queue: Missing releaseName.`)
      return false
    }

    const existing = this.queue.find((item) => item.releaseName === game.releaseName)

    if (existing) {
      if (existing.status === 'Completed') {
        console.log(`Game ${game.releaseName} already downloaded.`)
        return false
      } else if (existing.status !== 'Error' && existing.status !== 'Cancelled') {
        console.log(
          `Game ${game.releaseName} is already in the queue with status: ${existing.status}.`
        )
        return false
      }
      console.log(`Re-adding game ${game.releaseName} after previous ${existing.status}.`)
      this.queue = this.queue.filter((item) => item.releaseName !== game.releaseName)
    }

    const newItem: DownloadItem = {
      gameId: game.id,
      releaseName: game.releaseName,
      gameName: game.name,
      status: 'Queued',
      progress: 0,
      addedDate: Date.now(),
      thumbnailPath: game.thumbnailPath
    }
    this.queue.push(newItem)
    console.log(`Added ${game.releaseName} to download queue.`)
    this.emitUpdate()
    this.debouncedSaveQueue()
    this.processQueue()
    return true
  }

  public removeFromQueue(releaseName: string): void {
    const itemIndex = this.queue.findIndex((item) => item.releaseName === releaseName)
    if (itemIndex === -1) return

    const item = this.queue[itemIndex]

    if (item.status === 'Downloading') {
      this.cancelDownload(releaseName, 'Cancelled')
    } else {
      this.queue.splice(itemIndex, 1)
      console.log(`Removed ${releaseName} from queue.`)
      this.emitUpdate()
      this.debouncedSaveQueue()
    }
  }

  private cancelDownload(
    releaseName: string,
    finalStatus: 'Cancelled' | 'Error' = 'Cancelled',
    errorMsg?: string
  ): void {
    const process = this.activeDownloads.get(releaseName)
    if (process?.pid) {
      console.log(`Cancelling download for ${releaseName} (PID: ${process.pid})...`)
      // Detach listeners BEFORE killing to prevent processing stale output
      process.all?.removeAllListeners()

      try {
        // Commenting out kill options to avoid persistent linter error
        // process.kill('SIGTERM', {
        //   forceKillAfterTimeout: 2000
        // })
        process.kill('SIGTERM') // Standard SIGTERM
        console.log(`Sent kill signal to process for ${releaseName}.`)
      } catch (killError) {
        console.error(`Error killing process for ${releaseName}:`, killError)
      }
      this.activeDownloads.delete(releaseName)
    } else {
      console.log(`No active download process found for ${releaseName} to cancel.`)
    }

    const item = this.queue.find((i) => i.releaseName === releaseName)
    if (item) {
      if (!(item.status === 'Error' && finalStatus === 'Cancelled')) {
        item.status = finalStatus
      }
      item.pid = undefined
      if (finalStatus === 'Cancelled') {
        item.progress = 0
      }
      item.error = item.status === 'Error' ? errorMsg || item.error : undefined
      console.log(`Updated status for ${releaseName} to ${item.status}.`)
      this.updateItemStatus(
        item.releaseName,
        item.status,
        item.progress,
        item.error,
        item.speed,
        item.eta,
        item.extractProgress
      )
      this.emitUpdate()
    } else {
      console.warn(`Item ${releaseName} not found in queue during cancellation.`)
    }

    this.isProcessing = false
    this.processQueue()
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return
    if (!dependencyService.getStatus().rclone.ready) {
      console.warn('Rclone not ready, cannot process download queue.')
      return
    }

    const nextItem = this.queue.find((item) => item.status === 'Queued')
    if (!nextItem) {
      return
    }

    this.isProcessing = true
    try {
      await this.startDownload(nextItem)
    } catch (error) {
      console.error(`Error initiating download for ${nextItem.releaseName}:`, error)
      this.updateItemStatus(
        nextItem.releaseName,
        'Error',
        0,
        'Failed to start download',
        undefined,
        undefined,
        undefined
      )
      this.isProcessing = false
      this.processQueue()
    }
  }

  private async startDownload(item: DownloadItem): Promise<void> {
    console.log(`Starting download for ${item.releaseName}...`)

    if (!this.vrpConfig?.baseUri || !this.vrpConfig?.password) {
      console.error('Missing VRP baseUri or password. Cannot start download.')
      this.updateItemStatus(
        item.releaseName,
        'Error',
        0,
        'Missing VRP configuration',
        undefined,
        undefined,
        undefined
      )
      this.isProcessing = false
      this.processQueue()
      return
    }

    const rclonePath = dependencyService.getRclonePath()
    const downloadPath = join(this.downloadsDir, item.releaseName)
    item.downloadPath = downloadPath
    await fs.mkdir(downloadPath, { recursive: true })

    this.updateItemStatus(
      item.releaseName,
      'Downloading',
      0,
      undefined,
      undefined,
      undefined,
      undefined
    )

    const gameNameHash = crypto
      .createHash('md5')
      .update(item.releaseName + '\n')
      .digest('hex')

    const source = `:http:/${gameNameHash}`

    let rcloneProcess: ReturnType<typeof execa> | null = null

    try {
      rcloneProcess = execa(
        rclonePath,
        [
          'copy',
          source,
          downloadPath,
          '--http-url',
          this.vrpConfig.baseUri,
          '--no-check-certificate',
          '--progress',
          '--stats=1s',
          '--stats-one-line'
        ],
        {
          all: true,
          buffer: false,
          windowsHide: true
        }
      )

      if (!rcloneProcess || !rcloneProcess.pid || !rcloneProcess.all) {
        throw new Error('Failed to start rclone process.')
      }

      this.activeDownloads.set(item.releaseName, rcloneProcess)
      this.updateItemPid(item.releaseName, rcloneProcess.pid)

      console.log(`rclone process started for ${item.releaseName} with PID: ${rcloneProcess.pid}`)

      const transferLineRegex = /, (\d+)%, /
      const speedRegex = /, (\d+\.\d+ \S+?B\/s),/ // Capture speed like 10.123 MiB/s
      const etaRegex = /, ETA (\S+)/ // Capture ETA like 5m30s or -

      let outputBuffer = ''
      rcloneProcess.all.on('data', (data: Buffer) => {
        outputBuffer += data.toString()
        // Split by newline OR carriage return, removing empty strings
        const lines = outputBuffer.split(/\r\n|\n|\r/).filter((line) => line.length > 0)

        if (lines.length > 0) {
          // Check if the last element is a complete line
          const lastLineComplete = /ETA \S+$/.test(lines[lines.length - 1])

          // Determine which lines to process now vs. keep for later
          const linesToProcess = lastLineComplete ? lines : lines.slice(0, -1)
          outputBuffer = lastLineComplete ? '' : lines[lines.length - 1] // Keep last incomplete line

          for (const line of linesToProcess) {
            // Process each complete line
            console.log(`[DownloadService Raw Line] ${item.releaseName}: ${line}`)
            const progressMatch = line.match(transferLineRegex)
            if (progressMatch && progressMatch[1]) {
              const currentProgress = parseInt(progressMatch[1], 10)
              if (currentProgress > (item.progress || 0) || currentProgress === 0) {
                const speedMatch = line.match(speedRegex)
                const etaMatch = line.match(etaRegex)
                const speed = speedMatch?.[1] || item.speed
                const eta = etaMatch?.[1] || item.eta
                console.log(
                  `[DownloadService] Parsed progress: ${currentProgress}%, Speed: ${speed}, ETA: ${eta} for ${item.releaseName}`
                )
                this.updateItemStatus(
                  item.releaseName,
                  'Downloading',
                  currentProgress,
                  undefined,
                  speed,
                  eta,
                  item.extractProgress
                )
              }
            }
            if (line.includes('Auth Error') || line.includes('authentication failed')) {
              console.error(
                `Rclone (${item.releaseName}): Authentication failed. Check VRP password?`
              )
              this.cancelDownload(
                item.releaseName,
                'Error',
                'Authentication failed (check VRP password)'
              )
              return // Stop processing output for this failed download
            }
            if (line.includes("doesn't support hash type")) {
              console.warn(
                `Rclone (${item.releaseName}): Hash type not supported, verification might be skipped.`
              )
            }
          } // End of loop processing complete lines
        } // End of if (lines.length > 0)
      })

      await rcloneProcess

      console.log(`rclone process finished successfully for ${item.releaseName}.`)
      this.updateItemStatus(
        item.releaseName,
        'Completed',
        100,
        undefined,
        undefined,
        undefined,
        item.extractProgress
      )
      this.activeDownloads.delete(item.releaseName)
      this.updateItemPid(item.releaseName, undefined)

      // ---!!! DOWNLOAD COMPLETE - START EXTRACTION !!!---
      console.log(`Download finished successfully for ${item.releaseName}. Starting extraction...`)
      // Don't set status to Completed yet
      // this.updateItemStatus(item.releaseName, 'Completed', 100)
      await this.startExtraction(item)
      // ------------------------------------------------
    } catch (error: unknown) {
      const isExecaError = (err: unknown): err is ExecaError =>
        typeof err === 'object' && err !== null && 'shortMessage' in err

      // --- !!! CHECK FOR INTENTIONAL TERMINATION FIRST !!! ---
      // If the error is an ExecaError with exit code 143 (SIGTERM),
      // assume it's from our intentional kill signal for Pause/Cancel.
      if (isExecaError(error) && error.exitCode === 143) {
        // Log based on the status ALREADY set by cancelDownload
        const currentStatus =
          this.queue.find((i) => i.releaseName === item.releaseName)?.status || 'Unknown'
        console.log(
          `[DownloadService Catch] Ignoring expected SIGTERM (exit code 143) for ${item.releaseName}. Status when caught: ${currentStatus}`
        )
        // Status is (or will shortly be) Cancelled. Ensure processing continues.
        this.isProcessing = false
        this.processQueue()
        return // Exit the catch block
      }
      // ------------------------------------------------------

      // Log details for *unexpected* errors
      console.log(
        `[DownloadService Catch] Unexpected error for ${item.releaseName}. Status before catch: ${item.status}. isExecaError: ${isExecaError(error)}. ExitCode: ${isExecaError(error) ? error.exitCode : 'N/A'}`
      )

      console.error(
        `rclone process failed for ${item.releaseName}:`,
        isExecaError(error) ? error.shortMessage : error
      )
      this.activeDownloads.delete(item.releaseName)
      this.updateItemPid(item.releaseName, undefined)

      let errorMessage = 'Download failed.'
      if (isExecaError(error)) {
        if (error.isCanceled) {
          if (item.status === 'Cancelled') {
            console.log(`Download process for ${item.releaseName} terminated due to pause request.`)
          } else {
            console.log(`Download process for ${item.releaseName} was cancelled.`)
          }
          return
        } else if (error.stderr) {
          let stderrString: string | undefined
          if (typeof error.stderr === 'string') {
            stderrString = error.stderr
          } else if (Buffer.isBuffer(error.stderr)) {
            stderrString = error.stderr.toString()
          }
          errorMessage =
            stderrString
              ?.split('\n')
              .filter((line) => line.includes('ERROR'))
              .slice(-3)
              .join('\n') || ''
          if (!errorMessage) errorMessage = stderrString?.split('\n').slice(-5).join('\n') || ''
        } else if (error.stdout) {
          let stdoutString: string | undefined
          if (typeof error.stdout === 'string') {
            stdoutString = error.stdout
          } else if (Buffer.isBuffer(error.stdout)) {
            stdoutString = error.stdout.toString()
          }
          errorMessage =
            stdoutString
              ?.split('\n')
              .filter((line) => line.includes('ERROR'))
              .slice(-3)
              .join('\n') || ''
          if (!errorMessage) errorMessage = stdoutString?.split('\n').slice(-5).join('\n') || ''
        } else if (error.shortMessage) {
          errorMessage = error.shortMessage
        }
      } else if (error instanceof Error) {
        errorMessage = error.message
      } else {
        errorMessage = String(error)
      }

      errorMessage = errorMessage.substring(0, 500)

      this.updateItemStatus(
        item.releaseName,
        'Error',
        item.progress || 0,
        errorMessage,
        undefined,
        undefined,
        item.extractProgress
      )
    } finally {
      if (this.activeDownloads.has(item.releaseName)) {
        this.activeDownloads.delete(item.releaseName)
        this.updateItemPid(item.releaseName, undefined)
      }
      this.isProcessing = false
      this.processQueue()
    }
  }

  private updateItemStatus(
    releaseName: string,
    status: DownloadStatus,
    progress: number,
    error?: string,
    speed?: string,
    eta?: string,
    extractProgress?: number
  ): void {
    const item = this.queue.find((i) => i.releaseName === releaseName)
    if (item) {
      item.status = status
      item.progress = Math.max(0, Math.min(100, progress))
      item.error = error
      item.speed = speed
      item.eta = eta
      if (extractProgress !== undefined) {
        item.extractProgress = Math.max(0, Math.min(100, extractProgress))
      } else if (status !== 'Extracting') {
        item.extractProgress = undefined
      }
      this.debouncedEmitUpdate()
      this.debouncedSaveQueue()
    } else {
      console.warn(`Tried to update status for non-existent item: ${releaseName}`)
    }
  }

  private updateItemPid(releaseName: string, pid: number | undefined): void {
    const item = this.queue.find((i) => i.releaseName === releaseName)
    if (item) {
      item.pid = pid
    } else {
      console.warn(`Tried to update PID for non-existent item: ${releaseName}`)
    }
  }

  private emitUpdate(): void {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download:queue-updated', this.getQueue())
    }
  }

  public cancelUserRequest(releaseName: string): void {
    const item = this.queue.find((i) => i.releaseName === releaseName)
    if (item && (item.status === 'Downloading' || item.status === 'Queued')) {
      console.log(`User requested cancel for ${releaseName} download...`)
      this.cancelDownload(releaseName, 'Cancelled')
    } else if (item && item.status === 'Extracting') {
      console.log(`User requested cancel for ${releaseName} extraction...`)
      this.cancelExtraction(releaseName, 'Cancelled')
    } else {
      console.warn(`Cannot cancel item ${releaseName} - current status: ${item?.status}`)
    }
  }

  public retryDownload(releaseName: string): void {
    const item = this.queue.find((i) => i.releaseName === releaseName)
    if (item && (item.status === 'Cancelled' || item.status === 'Error')) {
      console.log(`Retrying download for ${releaseName}...`)
      if (this.activeExtractions.has(releaseName)) {
        console.warn(
          `Retrying item ${releaseName} that might have active extraction - cancelling extraction first.`
        )
        this.cancelExtraction(releaseName, 'Cancelled')
      }
      item.status = 'Queued'
      item.progress = 0
      item.extractProgress = undefined
      item.error = undefined
      item.pid = undefined
      this.emitUpdate()
      this.debouncedSaveQueue()
      this.processQueue()
    } else {
      console.warn(`Cannot retry download for ${releaseName} - current status: ${item?.status}`)
    }
  }

  private cancelExtraction(
    releaseName: string,
    finalStatus: 'Cancelled' | 'Error' = 'Cancelled',
    errorMsg?: string
  ): void {
    const process = this.activeExtractions.get(releaseName)
    if (process?.pid) {
      console.log(`Cancelling extraction for ${releaseName} (PID: ${process.pid})...`)
      process.all?.removeAllListeners()
      try {
        process.kill('SIGTERM')
        console.log(`Sent kill signal to extraction process for ${releaseName}.`)
      } catch (killError) {
        console.error(`Error killing extraction process for ${releaseName}:`, killError)
      }
      this.activeExtractions.delete(releaseName)
    } else {
      console.log(`No active extraction process found for ${releaseName} to cancel.`)
    }

    const item = this.queue.find((i) => i.releaseName === releaseName)
    if (item) {
      if (!(item.status === 'Error' && finalStatus === 'Cancelled')) {
        item.status = finalStatus
      }
      item.extractProgress = finalStatus === 'Error' ? item.extractProgress : undefined
      item.error = item.status === 'Error' ? errorMsg || item.error : undefined
      console.log(`Updated status for ${releaseName} to ${item.status} after extraction cancel.`)
      this.updateItemStatus(
        item.releaseName,
        item.status,
        item.progress,
        item.error,
        item.speed,
        item.eta,
        item.extractProgress
      )
      this.emitUpdate()
    } else {
      console.warn(`Item ${releaseName} not found in queue during extraction cancellation.`)
    }
  }

  private async startExtraction(item: DownloadItem): Promise<void> {
    console.log(`Starting extraction for ${item.releaseName}...`)
    const sevenZipPath = dependencyService.get7zPath()
    const downloadPath = item.downloadPath

    if (!downloadPath || !existsSync(downloadPath)) {
      this.updateItemStatus(
        item.releaseName,
        'Error',
        100,
        `Download path missing for ${item.releaseName}`,
        undefined,
        undefined,
        undefined
      )
      return
    }
    if (!dependencyService.getStatus().sevenZip.ready || !sevenZipPath) {
      this.updateItemStatus(item.releaseName, 'Error', 100, '7zip dependency not ready')
      return
    }

    const files = await fs.readdir(downloadPath)
    const archivePart1 = files.find((f) => f.endsWith('.7z.001'))

    if (!archivePart1) {
      this.updateItemStatus(
        item.releaseName,
        'Error',
        100,
        `Primary archive file (.7z.001) not found in ${downloadPath}`
      )
      return
    }
    const archivePath = join(downloadPath, archivePart1)

    this.updateItemStatus(item.releaseName, 'Extracting', 100, undefined, undefined, undefined, 0)

    let extractionProcess: ReturnType<typeof execa> | null = null

    let decodedPassword = ''
    try {
      decodedPassword = Buffer.from(this.vrpConfig?.password || '', 'base64').toString('utf-8')
    } catch (e: unknown) {
      console.error('Failed to decode VRP password.', e)
      this.updateItemStatus(item.releaseName, 'Error', 0, 'Invalid VRP password format.')
      this.isProcessing = false
      this.processQueue()
      return
    }

    try {
      console.log(`Executing: ${sevenZipPath} x "${archivePath}" -o"${downloadPath}" -y`)
      extractionProcess = execa(
        sevenZipPath,
        ['x', archivePath, `-o${downloadPath}`, '-y', `-p${decodedPassword}`],
        {
          all: true,
          windowsHide: true,
          buffer: false
        }
      )

      if (!extractionProcess || !extractionProcess.pid || !extractionProcess.all) {
        throw new Error('Failed to start 7zip process.')
      }

      this.activeExtractions.set(item.releaseName, extractionProcess)

      const progressRegex = /^\s*(\d+)%/
      let outputBuffer = ''

      extractionProcess.all.on('data', (data: Buffer) => {
        outputBuffer += data.toString()
        const lines = outputBuffer.split(/\r\n|\n|\r/).filter((line) => line.length > 0)

        if (lines.length > 0) {
          outputBuffer = ''
          for (const line of lines) {
            const progressMatch = line.match(progressRegex)
            if (progressMatch && progressMatch[1]) {
              const currentProgress = parseInt(progressMatch[1], 10)
              if (currentProgress > (item.extractProgress || 0) || currentProgress === 0) {
                console.log(
                  `[DownloadService] Parsed extraction progress: ${currentProgress}% for ${item.releaseName}`
                )
                this.updateItemStatus(
                  item.releaseName,
                  'Extracting',
                  100,
                  undefined,
                  undefined,
                  undefined,
                  currentProgress
                )
              }
            }
            if (line.includes('ERROR:') || line.includes('Error:')) {
              console.error(`[7z Error Line] ${item.releaseName}: ${line}`)
            }
          }
        }
      })

      await extractionProcess

      console.log(`Extraction finished successfully for ${item.releaseName}.`)
      this.updateItemStatus(
        item.releaseName,
        'Completed',
        100,
        undefined,
        undefined,
        undefined,
        100
      )
    } catch (error: unknown) {
      const isExecaError = (err: unknown): err is ExecaError =>
        typeof err === 'object' && err !== null && 'shortMessage' in err

      if (isExecaError(error) && error.exitCode === 143) {
        const currentStatus =
          this.queue.find((i) => i.releaseName === item.releaseName)?.status || 'Unknown'
        console.log(
          `[Extraction Catch] Ignoring expected SIGTERM for ${item.releaseName}. Status: ${currentStatus}`
        )
        return
      } else if (isExecaError(error) && error.isCanceled) {
        const currentStatus =
          this.queue.find((i) => i.releaseName === item.releaseName)?.status || 'Unknown'
        console.log(
          `[Extraction Catch] Ignoring expected cancellation for ${item.releaseName}. Status: ${currentStatus}`
        )
        return
      }

      console.error(`Extraction process failed for ${item.releaseName}:`, error)
      let errorMessage = 'Extraction failed.'
      if (isExecaError(error)) {
        errorMessage = error.shortMessage || errorMessage
        if (error.all) errorMessage += `\nOutput: ${error.all.slice(-500)}`
      } else if (error instanceof Error) {
        errorMessage = error.message
      }
      this.updateItemStatus(
        item.releaseName,
        'Error',
        100,
        errorMessage,
        undefined,
        undefined,
        item.extractProgress
      )
    } finally {
      if (this.activeExtractions.has(item.releaseName)) {
        this.activeExtractions.delete(item.releaseName)
      }
    }
  }
}

export default new DownloadService()
