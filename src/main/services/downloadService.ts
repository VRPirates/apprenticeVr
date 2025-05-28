import { BrowserWindow } from 'electron'
import { promises as fs, existsSync } from 'fs'
import adbService from './adbService'
import { EventEmitter } from 'events'
import { debounce } from './download/utils'
import { QueueManager } from './download/queueManager'
import { DownloadProcessor } from './download/downloadProcessor'
import { ExtractionProcessor } from './download/extractionProcessor'
import { InstallationProcessor } from './download/installationProcessor'
import { DownloadAPI, GameInfo, DownloadItem, DownloadStatus } from '@shared/types'
import settingsService from './settingsService'
import { typedWebContentsSend } from '@shared/ipc-utils'

interface VrpConfig {
  baseUri?: string
  password?: string
}

class DownloadService extends EventEmitter implements DownloadAPI {
  private downloadsPath: string
  private isInitialized = false
  private isProcessing = false
  private debouncedEmitUpdate: () => void
  private queueManager: QueueManager
  private downloadProcessor: DownloadProcessor
  private extractionProcessor: ExtractionProcessor
  private installationProcessor: InstallationProcessor
  private adbService: typeof adbService

  constructor() {
    super()
    const downloadPath = settingsService.getDownloadPath()
    settingsService.on('download-path-changed', (path) => {
      this.setDownloadPath(path)
    })
    this.downloadsPath = downloadPath

    this.queueManager = new QueueManager()
    this.adbService = adbService
    this.debouncedEmitUpdate = debounce(this.emitUpdate.bind(this), 300)
    this.downloadProcessor = new DownloadProcessor(this.queueManager, this.debouncedEmitUpdate)
    this.extractionProcessor = new ExtractionProcessor(this.queueManager, this.debouncedEmitUpdate)
    this.installationProcessor = new InstallationProcessor(
      this.queueManager,
      this.adbService,
      this.debouncedEmitUpdate
    )
  }

  setDownloadPath(path: string): void {
    this.downloadsPath = path
  }

  async initialize(vrpConfig: VrpConfig): Promise<void> {
    if (this.isInitialized) return
    console.log('Initializing DownloadService...')
    this.downloadProcessor.setVrpConfig(vrpConfig)
    this.extractionProcessor.setVrpConfig(vrpConfig)

    await fs.mkdir(this.downloadsPath, { recursive: true })
    await this.queueManager.loadQueue()

    const changed = this.queueManager.updateAllItems(
      (item) =>
        item.status === 'Downloading' ||
        item.status === 'Extracting' ||
        item.status === 'Installing',
      {
        status: 'Queued',
        pid: undefined,
        progress: 0,
        extractProgress: undefined
      }
    )

    if (changed) {
      console.log(
        'Reset status for items from Downloading/Extracting/Installing to Queued after restart.'
      )
    }

    this.isInitialized = true
    console.log('DownloadService initialized.')
    this.emitUpdate()
    this.processQueue()
  }

  public getQueue(): Promise<DownloadItem[]> {
    return Promise.resolve(this.queueManager.getQueue())
  }

  public addToQueue(game: GameInfo): Promise<boolean> {
    if (!this.isInitialized) {
      console.error('DownloadService not initialized. Cannot add to queue.')
      return Promise.resolve(false)
    }
    if (!game.releaseName) {
      console.error(`Cannot add game ${game.name} to queue: Missing releaseName.`)
      return Promise.resolve(false)
    }

    const existing = this.queueManager.findItem(game.releaseName)

    if (existing) {
      if (existing.status === 'Completed') {
        console.log(`Game ${game.releaseName} already downloaded.`)
        return Promise.resolve(false)
      } else if (existing.status !== 'Error' && existing.status !== 'Cancelled') {
        console.log(
          `Game ${game.releaseName} is already in the queue with status: ${existing.status}.`
        )
        return Promise.resolve(false)
      }
      console.log(`Re-adding game ${game.releaseName} after previous ${existing.status}.`)
      this.queueManager.removeItem(game.releaseName)
    }

    const newItem: DownloadItem = {
      gameId: game.id,
      releaseName: game.releaseName,
      packageName: game.packageName,
      gameName: game.name,
      status: 'Queued',
      progress: 0,
      addedDate: Date.now(),
      thumbnailPath: game.thumbnailPath,
      downloadPath: this.downloadsPath
    }
    this.queueManager.addItem(newItem)
    console.log(`Added ${game.releaseName} to download queue.`)
    this.emitUpdate()
    this.processQueue()
    return Promise.resolve(true)
  }

  public async removeFromQueue(releaseName: string): Promise<void> {
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
    }

    await this.deleteDownloadedFiles(releaseName)

    const removed = this.queueManager.removeItem(releaseName)
    if (removed) {
      console.log(`[Service] Removed ${releaseName} from queue (status: ${item.status}).`)
      this.emitUpdate()
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

    let targetDeviceId: string | null = null
    try {
      const devices = await this.adbService.listDevices()
      const authorizedDevices = devices.filter((d) => d.type === 'device')
      if (authorizedDevices.length === 1) {
        targetDeviceId = authorizedDevices[0].id
        console.log(`[Service ProcessQueue] Found single authorized device: ${targetDeviceId}`)
      } else if (authorizedDevices.length === 0) {
        console.log(
          '[Service ProcessQueue] No authorized devices found for potential installation.'
        )
      } else {
        console.log(
          `[Service ProcessQueue] Multiple authorized devices found (${authorizedDevices.length}). Installation requires a single target.`
        )
      }
    } catch (err) {
      console.error('[Service ProcessQueue] Error listing devices:', err)
      // Proceed without device ID, installation step will be skipped
    }

    try {
      const downloadResult = await this.downloadProcessor.startDownload(nextItem)
      if (!downloadResult.success) {
        console.log(
          `[Service ProcessQueue] Download failed/cancelled for ${nextItem.releaseName}. Status: ${downloadResult.finalState?.status}`
        )
        this.isProcessing = false
        this.processQueue()
        return
      }
      if (!downloadResult.startExtraction || !downloadResult.finalState) {
        console.log(
          `[Service ProcessQueue] Download successful but extraction flag not set for ${nextItem.releaseName}.`
        )
        this.isProcessing = false
        this.processQueue()
        return
      }
      const itemAfterDownload = downloadResult.finalState

      console.log(
        `[Service ProcessQueue] Download successful for ${itemAfterDownload.releaseName}. Starting extraction...`
      )
      const extractionSuccess = await this.extractionProcessor.startExtraction(itemAfterDownload)
      if (!extractionSuccess) {
        console.log(
          `[Service ProcessQueue] Extraction failed or was cancelled for ${itemAfterDownload.releaseName}.`
        )
        this.isProcessing = false
        this.processQueue()
        return
      }
      const itemAfterExtraction = this.queueManager.findItem(itemAfterDownload.releaseName)
      if (!itemAfterExtraction || itemAfterExtraction.status !== 'Completed') {
        console.warn(
          `[Service ProcessQueue] Extraction reported success for ${itemAfterDownload.releaseName}, but item status is now ${itemAfterExtraction?.status}. Skipping installation.`
        )
        this.isProcessing = false
        this.processQueue()
        return
      }

      if (!targetDeviceId) {
        console.warn(
          `[Service ProcessQueue] Extraction successful for ${itemAfterExtraction.releaseName}, but no single authorized device found for installation.`
        )
        // Mark as Completed (download/extract), installation skipped.
        this.isProcessing = false
        this.processQueue()
        return
      }

      console.log(
        `[Service ProcessQueue] Extraction successful for ${itemAfterExtraction.releaseName}. Starting installation on ${targetDeviceId}...`
      )
      const installationSuccess = await this.installationProcessor.startInstallation(
        itemAfterExtraction,
        targetDeviceId
      )
      if (installationSuccess) {
        // Emit event on successful installation
        this.emit('installation:success', targetDeviceId)
      } else {
        // Error is already logged by the installation processor
        console.error(
          `[Service ProcessQueue] Installation failed for ${itemAfterExtraction.releaseName}.`
        )
      } // No need for specific success log here, handled by processor

      this.isProcessing = false
      this.processQueue()
    } catch (error) {
      console.error(
        `[Service ProcessQueue] UNEXPECTED error in main processing loop for ${nextItem.releaseName}:`,
        error
      )
      const currentItem = this.queueManager.findItem(nextItem.releaseName)
      this.updateItemStatus(
        nextItem.releaseName,
        'Error',
        currentItem?.progress ?? 0,
        'Unexpected processing error',
        undefined,
        undefined,
        currentItem?.extractProgress
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
    } else if (
      status !== 'Extracting' &&
      status !== 'Completed' &&
      status !== 'Installing' &&
      status !== 'InstallError'
    ) {
      updates.extractProgress = undefined
    }
    if (status !== 'Downloading') {
      updates.speed = undefined
      updates.eta = undefined
    }
    if (status !== 'Downloading' && status !== 'Extracting' && status !== 'Installing') {
      updates.pid = undefined
    }
    if (status !== 'Error' && status !== 'InstallError') {
      updates.error = undefined
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
      typedWebContentsSend.send(mainWindow, 'download:queue-updated', this.queueManager.getQueue())
    }
  }

  public cancelUserRequest(releaseName: string): Promise<void> {
    const item = this.queueManager.findItem(releaseName)
    if (!item) {
      console.warn(`[Service cancelUserRequest] Cannot cancel ${releaseName} - not found.`)
      return Promise.resolve()
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
    } else if (item.status === 'Installing') {
      console.warn(
        `[Service cancelUserRequest] Cancellation requested for ${releaseName} during 'Installing' state - Not supported.`
      )
    } else {
      console.warn(
        `[Service cancelUserRequest] Cannot cancel ${releaseName} - status: ${item.status}`
      )
    }
    return Promise.resolve()
  }

  public retryDownload(releaseName: string): Promise<void> {
    const item = this.queueManager.findItem(releaseName)
    if (
      item &&
      (item.status === 'Cancelled' || item.status === 'Error' || item.status === 'InstallError')
    ) {
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
        downloadPath: this.downloadsPath,
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
    return Promise.resolve()
  }

  public async deleteDownloadedFiles(releaseName: string): Promise<boolean> {
    const item = this.queueManager.findItem(releaseName)
    if (!item) {
      console.warn(`Cannot delete files for ${releaseName}: Not found.`)
      return Promise.resolve(false)
    }

    const downloadPath = item.downloadPath

    if (!downloadPath) {
      console.log(`No download path for ${releaseName}, removing item.`)
      const removed = this.queueManager.removeItem(releaseName)
      if (removed) this.emitUpdate()
      return Promise.resolve(true)
    }

    if (!existsSync(downloadPath)) {
      console.log(`Path not found for ${releaseName}: ${downloadPath}. Removing item.`)
      const removed = this.queueManager.removeItem(releaseName)
      if (removed) this.emitUpdate()
      return Promise.resolve(true)
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
      return Promise.resolve(false)
    }
  }

  public async installFromCompleted(releaseName: string, deviceId: string): Promise<void> {
    console.log(`[Service] Request to install completed item: ${releaseName} on ${deviceId}`)
    const item = this.queueManager.findItem(releaseName)

    if (!item) {
      console.error(`[Service installFromCompleted] Item not found: ${releaseName}`)
      throw new Error(`Item not found: ${releaseName}`)
    }

    if (item.status !== 'Completed') {
      console.error(
        `[Service installFromCompleted] Item ${releaseName} has status ${item.status}, not 'Completed'. Cannot start installation.`
      )
      throw new Error(`Item ${releaseName} is not in 'Completed' state.`)
    }

    if (this.isProcessing) {
      console.warn(
        `[Service installFromCompleted] Queue is already processing. Installation for ${releaseName} will be handled if it becomes the next item.`
      )
      // Optionally, we could queue this specific action, but for now, let the main loop handle it
      // Or force a status change back to Queued? Seems counter-intuitive.
      // Let's just rely on the check within startInstallation to set status to Installing
      // and proceed if not already processing.
      // throw new Error('Queue is busy') // Maybe throw error?
      return // Don't throw, just log and return. Main loop might pick it up later?
    }

    // Check if the target device is still connected and authorized
    try {
      const devices = await this.adbService.listDevices()
      const targetDevice = devices.find((d) => d.id === deviceId && d.type === 'device')
      if (!targetDevice) {
        console.error(
          `[Service installFromCompleted] Target device ${deviceId} not found or not authorized.`
        )
        throw new Error(`Target device ${deviceId} not found or not authorized.`)
      }
    } catch (err) {
      console.error(
        `[Service installFromCompleted] Error verifying target device ${deviceId}:`,
        err
      )
      throw new Error(`Failed to verify target device ${deviceId}.`)
    }

    console.log(
      `[Service installFromCompleted] Triggering installation processor for ${releaseName} on ${deviceId}...`
    )

    // Directly trigger the installation processor
    // The installationProcessor will handle setting the status to 'Installing'
    try {
      const success = await this.installationProcessor.startInstallation(item, deviceId)
      // Log based on success
      if (success) {
        console.log(
          `[Service installFromCompleted] Installation process initiated and reported success for ${releaseName}.`
        )
        // Emit event on successful installation
        this.emit('installation:success', deviceId)
      } else {
        console.warn(
          `[Service installFromCompleted] Installation process initiated for ${releaseName} but reported failure.`
        )
      }
      // Note: We don't await the full completion here, just the initiation.
      // The status updates will come via the processor and emitUpdate.
    } catch (error) {
      console.error(
        `[Service installFromCompleted] Error initiating installation for ${releaseName}:`,
        error
      )
      // Attempt to set error status if possible
      this.updateItemStatus(
        releaseName,
        'InstallError',
        item.progress ?? 100, // Keep progress, default to 100 if undefined
        `Failed to start installation: ${error instanceof Error ? error.message : String(error)}`.substring(
          0,
          200
        ),
        undefined, // speed - not applicable
        undefined, // eta - not applicable
        item.extractProgress ?? 100 // Keep extract progress, default to 100 if undefined
      )
      // Re-throw or just log?
      throw error // Re-throw so the IPC handler logs it
    }
  }
}

export default new DownloadService()
