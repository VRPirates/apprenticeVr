import { app, BrowserWindow } from 'electron'
import { join, basename } from 'path'
import { promises as fs, existsSync } from 'fs'
import { execa, ExecaError } from 'execa'
import { GameInfo } from './gameService'
import { DownloadItem, DownloadStatus } from './download/types'
import dependencyService from './dependencyService'
import { EventEmitter } from 'events'
import { debounce } from './download/utils'
import { QueueManager } from './download/queueManager'
import { DownloadProcessor } from './download/downloadProcessor'

interface VrpConfig {
  baseUri?: string
  password?: string
}

class DownloadService extends EventEmitter {
  private downloadsDir: string
  private isInitialized = false
  private isProcessing = false
  private activeExtractions: Map<string, ReturnType<typeof execa>> = new Map()
  private debouncedEmitUpdate: () => void
  private queueManager: QueueManager
  private downloadProcessor: DownloadProcessor

  constructor() {
    super()
    this.queueManager = new QueueManager()
    this.downloadsDir = join(app.getPath('userData'), 'downloads')
    this.debouncedEmitUpdate = debounce(this.emitUpdate.bind(this), 300)
    this.downloadProcessor = new DownloadProcessor(
      this.queueManager,
      dependencyService,
      this.downloadsDir,
      this.debouncedEmitUpdate
    )
  }

  async initialize(vrpConfig: VrpConfig | null): Promise<void> {
    if (this.isInitialized) return
    console.log('Initializing DownloadService...')
    this.downloadProcessor.setVrpConfig(vrpConfig)

    await fs.mkdir(this.downloadsDir, { recursive: true })
    await this.queueManager.loadQueue()

    const changed = this.queueManager.updateAllItems(
      (item) => item.status === 'Downloading' || item.status === 'Extracting',
      {
        status: 'Queued',
        pid: undefined,
        progress: 0,
        extractProgress: undefined
      }
    )

    if (changed) {
      console.log('Reset status for items from Downloading/Extracting to Queued after restart.')
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
      this.downloadProcessor.cancelDownload(releaseName, 'Cancelled')
    } else if (item.status === 'Extracting') {
      this.cancelExtraction(releaseName)
      const updated = this.queueManager.updateItem(releaseName, {
        status: 'Cancelled',
        extractProgress: 0
      })
      if (updated) this.debouncedEmitUpdate()
    } else {
      const removed = this.queueManager.removeItem(releaseName)
      if (removed) {
        console.log(`Removed ${releaseName} from queue.`)
        this.emitUpdate()
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return
    if (!dependencyService.getStatus().rclone.ready) {
      console.warn('Rclone not ready, cannot process download queue.')
      return
    }

    const nextItem = this.queueManager.findNextQueuedItem()
    if (!nextItem) {
      this.isProcessing = false
      return
    }

    this.isProcessing = true
    console.log(`Processing next item: ${nextItem.releaseName}`)
    try {
      const downloadResult = await this.downloadProcessor.startDownload(nextItem)

      if (downloadResult.success && downloadResult.startExtraction && downloadResult.finalState) {
        console.log(`Download finished for ${nextItem.releaseName}. Starting extraction...`)
        await this.startExtraction(downloadResult.finalState)
      } else {
        console.log(
          `Download did not complete successfully for ${nextItem.releaseName}. Status: ${downloadResult.finalState?.status}`
        )
        this.isProcessing = false
        this.processQueue()
      }
    } catch (error) {
      console.error(
        `[Service ProcessQueue] Unexpected error processing ${nextItem.releaseName}:`,
        error
      )
      this.updateItemStatus(
        nextItem.releaseName,
        'Error',
        nextItem.progress ?? 0,
        'Unexpected processing error'
      )
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
      console.warn(`[Service updateItemStatus] Failed update for non-existent item: ${releaseName}`)
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
    if (!item) {
      console.warn(`Cannot cancel ${releaseName} - not found.`)
      return
    }

    console.log(`User requesting cancel for ${releaseName}, status: ${item.status}`)
    if (item.status === 'Downloading' || item.status === 'Queued') {
      this.downloadProcessor.cancelDownload(releaseName, 'Cancelled')
    } else if (item.status === 'Extracting') {
      console.log(`User cancelling extraction: ${releaseName}`)
      this.cancelExtraction(releaseName)
      const updated = this.queueManager.updateItem(releaseName, {
        status: 'Cancelled',
        extractProgress: 0,
        error: undefined,
        pid: undefined
      })
      if (updated) this.debouncedEmitUpdate()
    } else {
      console.warn(
        `Cannot cancel ${releaseName} - item is not in a cancellable state (${item.status})`
      )
    }
  }

  public retryDownload(releaseName: string): void {
    const item = this.queueManager.findItem(releaseName)
    if (item && (item.status === 'Cancelled' || item.status === 'Error')) {
      console.log(`Retrying download: ${releaseName}`)

      if (this.downloadProcessor.isDownloadActive(releaseName)) {
        console.warn(
          `Retrying item ${releaseName} that still has an active download process? Cancelling first.`
        )
        this.downloadProcessor.cancelDownload(releaseName, 'Error', 'Cancelled before retry')
      }
      if (this.activeExtractions.has(releaseName)) {
        console.warn(`Retrying item ${releaseName} with active extraction - cancelling first.`)
        this.cancelExtraction(releaseName)
      }

      const updated = this.queueManager.updateItem(releaseName, {
        status: 'Queued',
        progress: 0,
        extractProgress: undefined,
        error: undefined,
        pid: undefined,
        speed: undefined,
        eta: undefined
      })
      if (updated) {
        this.emitUpdate()
        this.processQueue()
      } else {
        console.warn(`Failed to update ${releaseName} for retry.`)
      }
    } else {
      console.warn(`Cannot retry ${releaseName} - status: ${item?.status}`)
    }
  }

  private cancelExtraction(releaseName: string): void {
    const extractionProcess = this.activeExtractions.get(releaseName)
    if (extractionProcess) {
      console.log(`[Service] Cancelling extraction: ${releaseName}`)
      try {
        if (extractionProcess.kill('SIGTERM')) {
          console.log(`[Service] Sent SIGTERM to extraction: ${releaseName}.`)
          const killTimeout = setTimeout(() => {
            if (this.activeExtractions.has(releaseName)) {
              console.warn(`[Service] Extraction ${releaseName} timed out, sending SIGKILL.`)
              extractionProcess.kill('SIGKILL')
              this.activeExtractions.delete(releaseName)
              this.queueManager.updateItem(releaseName, { pid: undefined })
            }
          }, 5000)
          extractionProcess.finally(() => {
            clearTimeout(killTimeout)
            this.activeExtractions.delete(releaseName)
            this.queueManager.updateItem(releaseName, { pid: undefined })
          })
        } else {
          console.warn(`[Service] Failed to send SIGTERM to extraction ${releaseName}.`)
          this.activeExtractions.delete(releaseName)
          this.queueManager.updateItem(releaseName, { pid: undefined })
        }
      } catch (killError) {
        console.error(`[Service] Error killing extraction ${releaseName}:`, killError)
        this.activeExtractions.delete(releaseName)
        this.queueManager.updateItem(releaseName, { pid: undefined })
      }
    } else {
      console.log(`[Service] No active extraction found to cancel for ${releaseName}.`)
      const item = this.queueManager.findItem(releaseName)
      if (item && item.status === 'Extracting') {
        this.updateItemStatus(releaseName, 'Error', item.progress ?? 100, 'Extraction process lost')
      }
    }
  }

  private async startExtraction(item: DownloadItem): Promise<void> {
    console.log(`[Service] Starting extraction: ${item.releaseName}`)
    const downloadPath = item.downloadPath

    if (!downloadPath || !existsSync(downloadPath)) {
      this.updateItemStatus(
        item.releaseName,
        'Error',
        100,
        `Invalid download path: ${downloadPath}`
      )
      this.isProcessing = false
      this.processQueue()
      return
    }
    if (!dependencyService.getStatus().sevenZip.ready) {
      this.updateItemStatus(item.releaseName, 'Error', 100, '7zip not ready')
      this.isProcessing = false
      this.processQueue()
      return
    }

    let files: string[]
    try {
      files = await fs.readdir(downloadPath)
    } catch (readDirError: unknown) {
      let errorMsg = 'Cannot read download dir'
      if (readDirError instanceof Error)
        errorMsg = `Cannot read download dir: ${readDirError.message}`
      this.updateItemStatus(item.releaseName, 'Error', 100, errorMsg.substring(0, 500))
      this.isProcessing = false
      this.processQueue()
      return
    }

    const archivePart1 = files.find((f) => f.endsWith('.7z.001'))
    if (!archivePart1) {
      this.updateItemStatus(item.releaseName, 'Error', 100, `.7z.001 not found in ${downloadPath}`)
      this.isProcessing = false
      this.processQueue()
      return
    }
    const archivePath = join(downloadPath, archivePart1)

    this.updateItemStatus(item.releaseName, 'Extracting', 100, undefined, undefined, undefined, 0)

    let decodedPassword = ''
    const currentVrpConfig = this.downloadProcessor.getVrpConfig()
    try {
      decodedPassword = Buffer.from(currentVrpConfig?.password || '', 'base64').toString('utf-8')
    } catch (e: unknown) {
      console.error('[Service] Failed to decode VRP password for extraction.', e)
      this.updateItemStatus(item.releaseName, 'Error', 100, 'Invalid VRP password')
      this.isProcessing = false
      this.processQueue()
      return
    }

    const sevenZipPath = dependencyService.get7zPath()
    if (!sevenZipPath) {
      this.updateItemStatus(
        item.releaseName,
        'Error',
        100,
        '7zip path not found',
        undefined,
        undefined,
        0
      )
      this.isProcessing = false
      this.processQueue()
      return
    }

    let sevenZipProcess: ReturnType<typeof execa> | null = null
    try {
      sevenZipProcess = execa(
        sevenZipPath,
        ['e', archivePath, '-aoa', '-bsp1', '-y', `-p${decodedPassword}`],
        {
          cwd: downloadPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          all: true,
          buffer: false,
          windowsHide: true
        }
      )

      if (!sevenZipProcess || !sevenZipProcess.pid || !sevenZipProcess.all)
        throw new Error('Failed to start 7zip')

      this.activeExtractions.set(item.releaseName, sevenZipProcess)
      this.queueManager.updateItem(item.releaseName, { pid: sevenZipProcess.pid })

      console.log(`[Service] 7zip started for ${item.releaseName}, PID: ${sevenZipProcess.pid}`)

      const progressRegex = /^\s*(\d+)%/
      let outputBuffer = ''

      sevenZipProcess.all.on('data', (data: Buffer) => {
        const currentItemState = this.queueManager.findItem(item.releaseName)
        if (!currentItemState || currentItemState.status !== 'Extracting') {
          console.warn(
            `[Service] Extraction data received for ${item.releaseName}, but state is ${currentItemState?.status}. Stopping data processing.`
          )
          const proc = this.activeExtractions.get(item.releaseName)
          proc?.kill('SIGTERM')
          this.activeExtractions.delete(item.releaseName)
          this.queueManager.updateItem(item.releaseName, { pid: undefined })
          return
        }

        outputBuffer += data.toString()
        let newlineIndex
        while ((newlineIndex = outputBuffer.indexOf('\n')) >= 0) {
          const line = outputBuffer.substring(0, newlineIndex).trim()
          outputBuffer = outputBuffer.substring(newlineIndex + 1)

          if (line.length > 0) {
            const progressMatch = line.match(progressRegex)
            if (progressMatch && progressMatch[1]) {
              const currentProgress = parseInt(progressMatch[1], 10)
              if (currentProgress >= (currentItemState.extractProgress ?? 0)) {
                this.queueManager.updateItem(item.releaseName, { extractProgress: currentProgress })
                this.debouncedEmitUpdate()
              }
            }
            if (line.includes('ERROR: Wrong password')) {
              console.error(`[Service] 7zip (${item.releaseName}): Wrong password.`)
              this.cancelExtraction(item.releaseName)
              this.updateItemStatus(
                item.releaseName,
                'Error',
                100,
                'Wrong password',
                undefined,
                undefined,
                currentItemState.extractProgress ?? 0
              )
            }
            if (line.includes('ERROR: Data Error') || line.includes('CRC Failed')) {
              console.error(`[Service] 7zip (${item.releaseName}): Data/CRC error.`)
              this.cancelExtraction(item.releaseName)
              this.updateItemStatus(
                item.releaseName,
                'Error',
                100,
                'Data/CRC error',
                undefined,
                undefined,
                currentItemState.extractProgress ?? 0
              )
            }
          }
        }
      })

      await sevenZipProcess

      const finalItemState = this.queueManager.findItem(item.releaseName)
      if (!finalItemState || finalItemState.status !== 'Extracting') {
        console.log(
          `[Service] Extraction finished for ${item.releaseName}, but status is now ${finalItemState?.status}. Skipping completion.`
        )
        if (this.activeExtractions.has(item.releaseName)) {
          this.activeExtractions.delete(item.releaseName)
          this.queueManager.updateItem(item.releaseName, { pid: undefined })
        }
        this.isProcessing = false
        this.processQueue()
        return
      }

      console.log(`[Service] Extraction complete: ${item.releaseName} in ${downloadPath}`)
      this.activeExtractions.delete(item.releaseName)
      this.queueManager.updateItem(item.releaseName, { pid: undefined })
      this.updateItemStatus(
        item.releaseName,
        'Completed',
        100,
        undefined,
        undefined,
        undefined,
        100
      )

      console.log(`[Service] Deleting archive parts for ${item.releaseName}`)
      try {
        const filesInDir = await fs.readdir(downloadPath)
        const baseArchiveName = basename(archivePath).split('.7z.')[0]
        const archiveParts = filesInDir.filter(
          (file) => file.startsWith(baseArchiveName) && file.includes('.7z.')
        )
        if (archiveParts.length > 0) {
          console.log(`[Service] Deleting: ${archiveParts.join(', ')}`)
          for (const part of archiveParts) {
            const partPath = join(downloadPath, part)
            try {
              await fs.unlink(partPath)
              console.log(`[Service] Deleted: ${partPath}`)
            } catch (unlinkError: unknown) {
              console.warn(`[Service] Failed to delete ${partPath}:`, unlinkError)
            }
          }
        } else {
          console.log(`[Service] No *.7z.* parts found for ${baseArchiveName}.`)
        }
      } catch (deleteError: unknown) {
        console.error(
          `[Service] Error during archive deletion for ${item.releaseName}:`,
          deleteError
        )
      }
    } catch (error: unknown) {
      const isExecaError = (err: unknown): err is ExecaError =>
        typeof err === 'object' && err !== null && 'shortMessage' in err
      const currentItemState = this.queueManager.findItem(item.releaseName)
      const statusBeforeCatch = currentItemState?.status ?? 'Unknown'

      if (
        isExecaError(error) &&
        (error.signal === 'SIGTERM' ||
          error.signal === 'SIGKILL' ||
          error.exitCode === 143 ||
          error.exitCode === 137)
      ) {
        console.log(
          `[Service Extraction Catch] Ignoring termination signal (${error.signal || 'Code ' + error.exitCode}) for ${item.releaseName}. Status: ${statusBeforeCatch}`
        )
        if (this.activeExtractions.has(item.releaseName)) {
          this.activeExtractions.delete(item.releaseName)
          this.queueManager.updateItem(item.releaseName, { pid: undefined })
        }
        this.isProcessing = false
        this.processQueue()
        return
      }

      console.error(`[Service] Extraction error for ${item.releaseName}:`, error)
      if (this.activeExtractions.has(item.releaseName)) {
        this.activeExtractions.delete(item.releaseName)
        this.queueManager.updateItem(item.releaseName, { pid: undefined })
      }

      let errorMessage = 'Extraction failed.'
      if (isExecaError(error)) {
        const output = String(error.all || error.stderr || error.stdout || '')
        if (output.includes('ERROR: Wrong password')) errorMessage = 'Wrong password'
        else if (output.includes('ERROR: Data Error') || output.includes('CRC Failed'))
          errorMessage = 'Data/CRC error'
        else errorMessage = error.shortMessage || error.message
        const lastLines = output.split('\n').slice(-3).join('\n')
        if (
          lastLines &&
          !errorMessage.includes('Wrong password') &&
          !errorMessage.includes('Data/CRC')
        )
          errorMessage += `\n...\n${lastLines}`
      } else if (error instanceof Error) errorMessage = error.message
      else errorMessage = String(error)
      errorMessage = errorMessage.substring(0, 500)

      if (statusBeforeCatch !== 'Cancelled' && statusBeforeCatch !== 'Error') {
        this.updateItemStatus(
          item.releaseName,
          'Error',
          100,
          errorMessage,
          undefined,
          undefined,
          currentItemState?.extractProgress ?? 0
        )
      } else {
        console.log(
          `[Service] Extraction error for ${item.releaseName}, but status already ${statusBeforeCatch}. Error: ${errorMessage}`
        )
        if (statusBeforeCatch === 'Error') {
          this.queueManager.updateItem(item.releaseName, { error: errorMessage })
          this.debouncedEmitUpdate()
        }
      }
      this.isProcessing = false
      this.processQueue()
    } finally {
      if (this.activeExtractions.has(item.releaseName)) {
        console.warn(
          `[Service] Active extraction ${item.releaseName} still exists in finally. Removing.`
        )
        this.activeExtractions.delete(item.releaseName)
        this.queueManager.updateItem(item.releaseName, { pid: undefined })
      }
      this.isProcessing = false
      this.processQueue()
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
