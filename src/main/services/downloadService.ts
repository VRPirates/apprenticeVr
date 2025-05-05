import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { GameInfo } from './gameService'
import { DownloadItem, DownloadStatus } from './download/types'
import dependencyService from './dependencyService'
import { EventEmitter } from 'events'
import { debounce } from './download/utils'
import { QueueManager } from './download/queueManager'
import { DownloadProcessor } from './download/downloadProcessor'
import { ExtractionProcessor } from './download/extractionProcessor'

interface VrpConfig {
  baseUri?: string
  password?: string
}

class DownloadService extends EventEmitter {
  private downloadsDir: string
  private isInitialized = false
  private isProcessing = false
  private debouncedEmitUpdate: () => void
  private queueManager: QueueManager
  private downloadProcessor: DownloadProcessor
  private extractionProcessor: ExtractionProcessor

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
    this.extractionProcessor = new ExtractionProcessor(
      this.queueManager,
      dependencyService,
      this.debouncedEmitUpdate
    )
  }

  async initialize(vrpConfig: VrpConfig | null): Promise<void> {
    if (this.isInitialized) return
    console.log('Initializing DownloadService...')
    this.downloadProcessor.setVrpConfig(vrpConfig)
    this.extractionProcessor.setVrpConfig(vrpConfig)

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
      console.log(`[Service] Requesting cancel download for ${releaseName}`)
      this.downloadProcessor.cancelDownload(releaseName, 'Cancelled')
    } else if (item.status === 'Extracting') {
      console.log(`[Service] Requesting cancel extraction for ${releaseName}`)
      this.extractionProcessor.cancelExtraction(releaseName)
      const updated = this.queueManager.updateItem(releaseName, {
        status: 'Cancelled',
        extractProgress: 0,
        pid: undefined,
        error: undefined
      })
      if (updated) this.debouncedEmitUpdate()
    } else {
      const removed = this.queueManager.removeItem(releaseName)
      if (removed) {
        console.log(`[Service] Removed ${releaseName} from queue (status: ${item.status}).`)
        this.emitUpdate()
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return
    const nextItem = this.queueManager.findNextQueuedItem()
    if (!nextItem) {
      this.isProcessing = false
      return
    }

    this.isProcessing = true
    console.log(`[Service ProcessQueue] Processing next item: ${nextItem.releaseName}`)
    try {
      const downloadResult = await this.downloadProcessor.startDownload(nextItem)

      if (downloadResult.success && downloadResult.startExtraction && downloadResult.finalState) {
        console.log(
          `[Service ProcessQueue] Download successful for ${nextItem.releaseName}. Starting extraction...`
        )
        const extractionSuccess = await this.extractionProcessor.startExtraction(
          downloadResult.finalState
        )

        if (extractionSuccess) {
          console.log(`[Service ProcessQueue] Extraction successful for ${nextItem.releaseName}.`)
        } else {
          console.log(
            `[Service ProcessQueue] Extraction failed or was cancelled for ${nextItem.releaseName}.`
          )
        }
        this.isProcessing = false
        this.processQueue()
      } else {
        console.log(
          `[Service ProcessQueue] Download did not complete successfully for ${nextItem.releaseName}. Status: ${downloadResult.finalState?.status}`
        )
        this.isProcessing = false
        this.processQueue()
      }
    } catch (error) {
      console.error(
        `[Service ProcessQueue] UNEXPECTED error processing ${nextItem.releaseName}:`,
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
      console.warn(`[Service cancelUserRequest] Cannot cancel ${releaseName} - not found.`)
      return
    }

    console.log(
      `[Service cancelUserRequest] User requesting cancel for ${releaseName}, status: ${item.status}`
    )
    if (item.status === 'Downloading' || item.status === 'Queued') {
      this.downloadProcessor.cancelDownload(releaseName, 'Cancelled')
    } else if (item.status === 'Extracting') {
      this.extractionProcessor.cancelExtraction(releaseName)
      const updated = this.queueManager.updateItem(releaseName, {
        status: 'Cancelled',
        extractProgress: 0,
        pid: undefined,
        error: undefined
      })
      if (updated) this.debouncedEmitUpdate()
    } else {
      console.warn(
        `[Service cancelUserRequest] Cannot cancel ${releaseName} - status: ${item.status}`
      )
    }
  }

  public retryDownload(releaseName: string): void {
    const item = this.queueManager.findItem(releaseName)
    if (item && (item.status === 'Cancelled' || item.status === 'Error')) {
      console.log(`[Service] Retrying download: ${releaseName}`)

      if (this.downloadProcessor.isDownloadActive(releaseName)) {
        console.warn(
          `[Service Retry] Retrying item ${releaseName} with active download - cancelling first.`
        )
        this.downloadProcessor.cancelDownload(releaseName, 'Error', 'Cancelled before retry')
      }
      if (this.extractionProcessor.isExtractionActive(releaseName)) {
        console.warn(
          `[Service Retry] Retrying item ${releaseName} with active extraction - cancelling first.`
        )
        this.extractionProcessor.cancelExtraction(releaseName)
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
        console.warn(`[Service Retry] Failed to update ${releaseName} for retry.`)
      }
    } else {
      console.warn(`[Service Retry] Cannot retry ${releaseName} - status: ${item?.status}`)
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
