import { app, BrowserWindow } from 'electron'
import { join, basename } from 'path'
import { promises as fs, existsSync } from 'fs'
import { execa, ExecaError } from 'execa'
import { GameInfo } from './gameService'
import { DownloadItem, DownloadStatus } from './download/types'
import dependencyService from './dependencyService'
import { EventEmitter } from 'events'
import crypto from 'crypto'
import { debounce } from './download/utils'
import { QueueManager } from './download/queueManager'

class DownloadService extends EventEmitter {
  private downloadsDir: string
  private isInitialized = false
  private isProcessing = false
  private activeDownloads: Map<string, ReturnType<typeof execa>> = new Map()
  private activeExtractions: Map<string, ReturnType<typeof execa>> = new Map()
  private vrpConfig: { baseUri?: string; password?: string } | null = null
  private debouncedEmitUpdate: () => void
  private queueManager: QueueManager

  constructor() {
    super()
    this.queueManager = new QueueManager()
    this.downloadsDir = join(app.getPath('userData'), 'downloads')
    this.debouncedEmitUpdate = debounce(this.emitUpdate.bind(this), 300)
  }

  async initialize(vrpConfig: { baseUri?: string; password?: string } | null): Promise<void> {
    if (this.isInitialized) return
    console.log('Initializing DownloadService...')
    this.vrpConfig = vrpConfig
    await fs.mkdir(this.downloadsDir, { recursive: true })
    await this.queueManager.loadQueue()

    const changed = this.queueManager.updateAllItems((item) => item.status === 'Downloading', {
      status: 'Queued',
      pid: undefined,
      progress: 0
    })

    if (changed) {
      console.log('Reset status for items from Downloading to Queued after restart.')
    }

    this.isInitialized = true
    console.log('DownloadService initialized.')
    this.emitUpdate()
    this.processQueue()
  }

  public getQueue(): DownloadItem[] {
    return this.queueManager.getQueue()
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

    const existing = this.queueManager.findItem(game.releaseName)

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
      this.queueManager.removeItem(game.releaseName)
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
    this.queueManager.addItem(newItem)
    console.log(`Added ${game.releaseName} to download queue.`)
    this.emitUpdate()
    this.processQueue()
    return true
  }

  public removeFromQueue(releaseName: string): void {
    const item = this.queueManager.findItem(releaseName)
    if (!item) return

    if (item.status === 'Downloading') {
      this.cancelDownload(releaseName, 'Cancelled')
    } else if (item.status === 'Extracting') {
      this.cancelExtraction(releaseName)
      const removed = this.queueManager.removeItem(releaseName)
      if (removed) {
        console.log(`Removed ${releaseName} from queue after cancelling extraction.`)
        this.emitUpdate()
      }
    } else {
      const removed = this.queueManager.removeItem(releaseName)
      if (removed) {
        console.log(`Removed ${releaseName} from queue.`)
        this.emitUpdate()
      }
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
      process.all?.removeAllListeners()

      try {
        process.kill('SIGTERM')
        console.log(`Sent kill signal to process for ${releaseName}.`)
      } catch (killError) {
        console.error(`Error killing process for ${releaseName}:`, killError)
      }
      this.activeDownloads.delete(releaseName)
    } else {
      console.log(`No active download process found for ${releaseName} to cancel.`)
    }

    const item = this.queueManager.findItem(releaseName)
    if (item) {
      const updates: Partial<DownloadItem> = {
        pid: undefined
      }
      if (!(item.status === 'Error' && finalStatus === 'Cancelled')) {
        updates.status = finalStatus
      }
      if (finalStatus === 'Cancelled') {
        updates.progress = 0
      }
      if (finalStatus === 'Error') {
        updates.error = errorMsg || item.error
      } else {
        updates.error = undefined
      }

      const updated = this.queueManager.updateItem(releaseName, updates)
      if (updated) {
        console.log(`Updated status for ${releaseName} to ${finalStatus}.`)
        this.debouncedEmitUpdate()
      } else {
        console.warn(`Failed to update item ${releaseName} during cancellation.`)
      }
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

    const nextItem = this.queueManager.findNextQueuedItem()
    if (!nextItem) {
      console.log('Download queue is empty or no items are queued.')
      this.isProcessing = false
      return
    }

    this.isProcessing = true
    try {
      await this.startDownload(nextItem)
    } catch (error) {
      console.error(`Error initiating download for ${nextItem.releaseName}:`, error)
      this.updateItemStatus(nextItem.releaseName, 'Error', 0, 'Failed to start download')
      this.isProcessing = false
      this.processQueue()
    }
  }

  private async startDownload(item: DownloadItem): Promise<void> {
    console.log(`Starting download for ${item.releaseName}...`)

    if (!this.vrpConfig?.baseUri || !this.vrpConfig?.password) {
      console.error('Missing VRP baseUri or password. Cannot start download.')
      this.updateItemStatus(item.releaseName, 'Error', 0, 'Missing VRP configuration')
      this.isProcessing = false
      this.processQueue()
      return
    }

    const rclonePath = dependencyService.getRclonePath()
    const downloadPath = join(this.downloadsDir, item.releaseName)
    this.queueManager.updateItem(item.releaseName, { downloadPath: downloadPath })

    await fs.mkdir(downloadPath, { recursive: true })

    this.updateItemStatus(item.releaseName, 'Downloading', 0)

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
      this.queueManager.updateItem(item.releaseName, { pid: rcloneProcess.pid })

      console.log(`rclone process started for ${item.releaseName} with PID: ${rcloneProcess.pid}`)

      const transferLineRegex = /, (\d+)%, /
      const speedRegex = /, (\d+\.\d+ \S+?B\/s),/
      const etaRegex = /, ETA (\S+)/

      let outputBuffer = ''
      rcloneProcess.all.on('data', (data: Buffer) => {
        const currentItemState = this.queueManager.findItem(item.releaseName)
        if (!currentItemState) {
          console.warn(`Item ${item.releaseName} disappeared during download data processing.`)
          const proc = this.activeDownloads.get(item.releaseName)
          proc?.kill('SIGTERM')
          this.activeDownloads.delete(item.releaseName)
          return
        }

        outputBuffer += data.toString()
        const lines = outputBuffer.split(/\r\n|\n|\r/).filter((line) => line.length > 0)

        if (lines.length > 0) {
          const lastLineComplete = /ETA \S+$/.test(lines[lines.length - 1])
          const linesToProcess = lastLineComplete ? lines : lines.slice(0, -1)
          outputBuffer = lastLineComplete ? '' : lines[lines.length - 1]

          for (const line of linesToProcess) {
            console.log(`[DownloadService Raw Line] ${item.releaseName}: ${line}`)
            const progressMatch = line.match(transferLineRegex)
            if (progressMatch && progressMatch[1]) {
              const currentProgress = parseInt(progressMatch[1], 10)
              if (currentProgress > (currentItemState.progress ?? 0) || currentProgress === 0) {
                const speedMatch = line.match(speedRegex)
                const etaMatch = line.match(etaRegex)
                const speed = speedMatch?.[1] || currentItemState.speed
                const eta = etaMatch?.[1] || currentItemState.eta
                console.log(
                  `[DownloadService] Parsed progress: ${currentProgress}%, Speed: ${speed}, ETA: ${eta} for ${item.releaseName}`
                )
                this.updateItemStatus(
                  item.releaseName,
                  'Downloading',
                  currentProgress,
                  undefined,
                  speed,
                  eta
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
        const currentStatus = this.queueManager.findItem(item.releaseName)?.status || 'Unknown'
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
    const updates: Partial<DownloadItem> = { status, progress, error, speed, eta }
    if (extractProgress !== undefined) {
      updates.extractProgress = extractProgress
    } else if (status !== 'Extracting' && status !== 'Completed') {
      updates.extractProgress = undefined
    }

    const updated = this.queueManager.updateItem(releaseName, updates)
    if (updated) {
      this.debouncedEmitUpdate()
    } else {
      console.warn(
        `Tried to update status for non-existent item via central method: ${releaseName}`
      )
    }
  }

  private emitUpdate(): void {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download:queue-updated', this.queueManager.getQueue())
    }
  }

  public cancelUserRequest(releaseName: string): void {
    const item = this.queueManager.findItem(releaseName)
    if (item && (item.status === 'Downloading' || item.status === 'Queued')) {
      console.log(`User requested cancel for ${releaseName} download...`)
      this.cancelDownload(releaseName, 'Cancelled')
    } else if (item && item.status === 'Extracting') {
      console.log(`User requested cancel for ${releaseName} extraction...`)
      this.cancelExtraction(releaseName)
    } else {
      console.warn(`Cannot cancel item ${releaseName} - current status: ${item?.status}`)
    }
  }

  public retryDownload(releaseName: string): void {
    const item = this.queueManager.findItem(releaseName)
    if (item && (item.status === 'Cancelled' || item.status === 'Error')) {
      console.log(`Retrying download for ${releaseName}...`)
      if (this.activeExtractions.has(releaseName)) {
        console.warn(
          `Retrying item ${releaseName} that might have active extraction - cancelling extraction first.`
        )
        this.cancelExtraction(releaseName)
      }
      item.status = 'Queued'
      item.progress = 0
      item.extractProgress = undefined
      item.error = undefined
      item.pid = undefined
      this.emitUpdate()
      this.processQueue()
    } else {
      console.warn(`Cannot retry download for ${releaseName} - current status: ${item?.status}`)
    }
  }

  private cancelExtraction(releaseName: string): void {
    const extractionProcess = this.activeExtractions.get(releaseName)
    if (extractionProcess) {
      console.log(`Cancelling extraction for ${releaseName}...`)
      if (extractionProcess.kill('SIGTERM')) {
        // Try graceful termination first
        console.log(`Sent SIGTERM to extraction process for ${releaseName}.`)
        // Set a timeout to force kill if it doesn't terminate
        const killTimeout = setTimeout(() => {
          if (this.activeExtractions.has(releaseName)) {
            // Check if it's still running
            console.warn(
              `Extraction process for ${releaseName} did not terminate gracefully, sending SIGKILL.`
            )
            extractionProcess.kill('SIGKILL') // Force kill
            this.activeExtractions.delete(releaseName) // Ensure cleanup
          }
        }, 5000) // 5 second timeout

        // Clear the timeout if the process exits cleanly before the timeout
        extractionProcess.finally(() => {
          clearTimeout(killTimeout)
          // No need to delete here, finally() runs after timeout callback if needed
        })
      } else {
        console.warn(
          `Failed to send SIGTERM to extraction process for ${releaseName}. It might already be stopped.`
        )
        this.activeExtractions.delete(releaseName) // Clean up if sending failed
      }

      // Status is updated by the calling function (cancelUserRequest or retryDownload)
    } else {
      console.log(`No active extraction process found to cancel for ${releaseName}.`)
      this.updateItemStatus(releaseName, 'Error', 100, 'No active extraction process found')
    }
  }

  private async startExtraction(item: DownloadItem): Promise<void> {
    console.log(`Starting extraction for ${item.releaseName}...`)
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
    if (!dependencyService.getStatus().sevenZip.ready) {
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
      // Run 7zip extraction
      const sevenZipPath = dependencyService.get7zPath()
      if (!sevenZipPath) {
        this.updateItemStatus(
          item.releaseName,
          'Error',
          item.progress,
          '7zip dependency not found for extraction',
          undefined,
          undefined,
          item.extractProgress
        )
        return
      }

      // Use 'e' instead of 'x' to extract directly into downloadPath
      // Set cwd to ensure extraction happens in the correct folder
      const sevenZipProcess = execa(
        sevenZipPath,
        [
          'e', // Extract files to current directory (specified by cwd)
          archivePath,
          '-aoa', // Overwrite existing files without prompt
          '-bsp1', // Output progress to stdout
          '-y', // Assume Yes on all queries
          `-p${decodedPassword}`
        ],
        {
          cwd: downloadPath, // Set the working directory for extraction
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )

      // ... existing code ...

      // Wait for the process to finish
      await sevenZipProcess

      console.log(`Extraction complete for ${item.releaseName} in ${downloadPath}`)
      this.activeExtractions.delete(item.releaseName)
      this.updateItemStatus(
        item.releaseName,
        'Completed', // Final status after successful extraction
        100,
        undefined, // Clear error
        undefined, // Clear speed
        undefined, // Clear eta
        100 // Set extraction progress to 100
      )

      // --- Delete archive files after successful extraction --- START
      console.log(`Attempting to delete archive parts for ${item.releaseName} in ${downloadPath}`)
      try {
        const filesInDir = await fs.readdir(downloadPath)
        const baseArchiveName = basename(archivePath).split('.7z.')[0]
        const archiveParts = filesInDir.filter(
          (file) => file.startsWith(baseArchiveName) && file.includes('.7z.')
        )

        if (archiveParts.length > 0) {
          console.log(`Found archive parts to delete: ${archiveParts.join(', ')}`)
          for (const part of archiveParts) {
            const partPath = join(downloadPath, part)
            try {
              await fs.unlink(partPath)
              console.log(`Deleted archive part: ${partPath}`)
            } catch (unlinkError) {
              console.warn(`Failed to delete archive part ${partPath}:`, unlinkError)
              // Log warning but continue
            }
          }
        } else {
          console.log(`No archive parts found matching ${baseArchiveName}.7z.* for deletion.`)
        }
      } catch (deleteError) {
        console.error(
          `Error listing or deleting archive parts for ${item.releaseName}:`,
          deleteError
        )
        // Log error but don't change the item status (extraction was successful)
      }
      // --- Delete archive files after successful extraction --- END

      this.isProcessing = false // Allow next download/extraction
      this.processQueue() // Check if there's another item to process
    } catch (error: unknown) {
      console.error(`Error during extraction for ${item.releaseName}:`, error)
      // ... existing error handling ...
    }
  }

  public async deleteDownloadedFiles(releaseName: string): Promise<boolean> {
    const item = this.queueManager.findItem(releaseName)
    if (!item) {
      console.warn(`Cannot delete files for ${releaseName}: Not found.`)
      return false
    }

    const downloadPath = item.downloadPath

    if (!downloadPath) {
      console.log(`No download path for ${releaseName}, removing item.`)
      const removed = this.queueManager.removeItem(releaseName)
      if (removed) this.emitUpdate()
      return true
    }

    if (!existsSync(downloadPath)) {
      console.log(`Path not found for ${releaseName}: ${downloadPath}. Removing item.`)
      const removed = this.queueManager.removeItem(releaseName)
      if (removed) this.emitUpdate()
      return true
    }

    console.log(`Deleting directory: ${downloadPath} for ${releaseName}...`)
    try {
      await fs.rm(downloadPath, { recursive: true, force: true })
      console.log(`Deleted directory ${downloadPath}.`)
      const removed = this.queueManager.removeItem(releaseName)
      if (removed) this.emitUpdate()
      return true
    } catch (error: unknown) {
      console.error(`Error deleting ${downloadPath} for ${releaseName}:`, error)
      // Update error status via QueueManager
      let errorMsg = 'Failed to delete files.'
      if (error instanceof Error) {
        errorMsg = `Failed to delete files: ${error.message}`.substring(0, 200)
      } else {
        errorMsg = `Failed to delete files: ${String(error)}`.substring(0, 200)
      }
      const updated = this.queueManager.updateItem(releaseName, { error: errorMsg })
      if (updated) this.emitUpdate()
      return false
    }
  }
}

export default new DownloadService()
