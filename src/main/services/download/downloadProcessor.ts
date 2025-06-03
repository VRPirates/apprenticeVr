import { join } from 'path'
import { promises as fs } from 'fs'
import { execa, ExecaError } from 'execa'
import crypto from 'crypto'
import { QueueManager } from './queueManager'
import dependencyService from '../dependencyService'
import mirrorService from '../mirrorService'
import settingsService from '../settingsService'
import { DownloadItem } from '@shared/types'
import { DownloadStatus } from '@shared/types'

// Type for VRP config - adjust if needed elsewhere
interface VrpConfig {
  baseUri?: string
  password?: string
}

export class DownloadProcessor {
  private activeDownloads: Map<string, ReturnType<typeof execa>> = new Map()
  private queueManager: QueueManager
  private vrpConfig: VrpConfig | null = null
  private debouncedEmitUpdate: () => void

  constructor(queueManager: QueueManager, debouncedEmitUpdate: () => void) {
    this.queueManager = queueManager
    this.debouncedEmitUpdate = debouncedEmitUpdate
  }

  public setVrpConfig(config: VrpConfig | null): void {
    this.vrpConfig = config
  }

  // Add getter for vrpConfig
  public getVrpConfig(): VrpConfig | null {
    return this.vrpConfig
  }

  // Centralized update method using QueueManager and emitting update
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
      this.debouncedEmitUpdate() // Use the passed-in emitter
    }
  }

  public cancelDownload(
    releaseName: string,
    finalStatus: 'Cancelled' | 'Error' = 'Cancelled',
    errorMsg?: string
  ): void {
    const process = this.activeDownloads.get(releaseName)
    if (process?.pid) {
      console.log(`[DownProc] Cancelling download for ${releaseName} (PID: ${process.pid})...`)
      process.all?.removeAllListeners() // Detach listeners first
      try {
        process.kill('SIGTERM')
        console.log(`[DownProc] Sent SIGTERM to process for ${releaseName}.`)
      } catch (killError) {
        console.error(`[DownProc] Error killing process for ${releaseName}:`, killError)
      }
      this.activeDownloads.delete(releaseName)
    } else {
      console.log(`[DownProc] No active download process found for ${releaseName} to cancel.`)
    }

    // QueueManager handles the status update logic now
    const item = this.queueManager.findItem(releaseName)
    if (item) {
      const updates: Partial<DownloadItem> = { pid: undefined }
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
        console.log(
          `[DownProc] Updated status for ${releaseName} to ${finalStatus} via QueueManager.`
        )
        this.debouncedEmitUpdate() // Ensure UI update on cancel
      } else {
        console.warn(`[DownProc] Failed to update item ${releaseName} during cancellation.`)
      }
    } else {
      console.warn(`[DownProc] Item ${releaseName} not found in queue during cancellation.`)
    }
    // The main service will handle resetting isProcessing and calling processQueue
  }

  public async startDownload(
    item: DownloadItem
  ): Promise<{ success: boolean; startExtraction: boolean; finalState?: DownloadItem }> {
    console.log(`[DownProc] Starting download for ${item.releaseName}...`)

    if (!this.vrpConfig?.baseUri || !this.vrpConfig?.password) {
      console.error('[DownProc] Missing VRP baseUri or password.')
      this.updateItemStatus(item.releaseName, 'Error', 0, 'Missing VRP configuration')
      return { success: false, startExtraction: false }
    }

    const rclonePath = dependencyService.getRclonePath()
    if (!rclonePath) {
      console.error('[DownProc] Rclone path not found.')
      this.updateItemStatus(item.releaseName, 'Error', 0, 'Rclone dependency not found')
      return { success: false, startExtraction: false }
    }

    const downloadPath = join(item.downloadPath, item.releaseName)
    this.queueManager.updateItem(item.releaseName, { downloadPath: downloadPath })

    try {
      await fs.mkdir(downloadPath, { recursive: true })
    } catch (mkdirError: unknown) {
      let errorMsg = `Failed to create directory ${downloadPath}`
      if (mkdirError instanceof Error) {
        errorMsg = `Failed to create directory: ${mkdirError.message}`
      }
      console.error(`[DownProc] Failed to create download directory ${downloadPath}:`, mkdirError)
      this.updateItemStatus(item.releaseName, 'Error', 0, errorMsg.substring(0, 500))
      return { success: false, startExtraction: false }
    }

    this.updateItemStatus(item.releaseName, 'Downloading', 0)

    // Check if there's an active mirror to use
    const activeMirror = await mirrorService.getActiveMirror()
    let rcloneProcess: ReturnType<typeof execa> | null = null

    if (activeMirror) {
      console.log(`[DownProc] Using active mirror: ${activeMirror.name}`)

      // Get the config file path and remote name
      const configFilePath = mirrorService.getActiveMirrorConfigPath()
      const remoteName = mirrorService.getActiveMirrorRemoteName()

      if (!configFilePath || !remoteName) {
        console.warn(
          '[DownProc] Failed to get mirror config file path, falling back to public endpoint'
        )
        // Fall back to public endpoint logic below
      } else {
        try {
          // Use mirror with direct config file reference
          const source = `${remoteName}:/Quest Games/${item.releaseName}`

          rcloneProcess = execa(
            rclonePath,
            [
              'copy',
              source,
              downloadPath,
              '--config',
              configFilePath,
              '--no-check-certificate',
              '--progress',
              '--stats=1s',
              '--stats-one-line',
              ...(settingsService.getDownloadSpeedLimit() > 0
                ? [`--bwlimit`, `${settingsService.getDownloadSpeedLimit()}K`]
                : []),
              ...(settingsService.getUploadSpeedLimit() > 0
                ? [`--tpslimit`, `${settingsService.getUploadSpeedLimit()}`]
                : [])
            ],
            { all: true, buffer: false, windowsHide: true }
          )

          if (!rcloneProcess || !rcloneProcess.pid || !rcloneProcess.all) {
            throw new Error('Failed to start rclone process with mirror.')
          }

          this.activeDownloads.set(item.releaseName, rcloneProcess)
          this.queueManager.updateItem(item.releaseName, { pid: rcloneProcess.pid })

          console.log(
            `[DownProc] rclone process started for ${item.releaseName} with mirror PID: ${rcloneProcess.pid}`
          )

          const transferLineRegex = /, (\d+)%, /
          const speedRegex = /, (\d+\.\d+ \S+?B\/s),/
          const etaRegex = /, ETA (\S+)/

          let outputBuffer = ''
          rcloneProcess.all.on('data', (data: Buffer) => {
            const currentItemState = this.queueManager.findItem(item.releaseName)
            if (!currentItemState || currentItemState.status !== 'Downloading') {
              console.warn(
                `[DownProc] Item ${item.releaseName} state changed to ${currentItemState?.status} during mirror download. Stopping data processing.`
              )
              const proc = this.activeDownloads.get(item.releaseName)
              if (proc) {
                proc.all?.removeAllListeners()
                proc.kill('SIGTERM')
                this.activeDownloads.delete(item.releaseName)
              }
              return
            }
            outputBuffer += data.toString()
            const lines = outputBuffer.split(/\r\n|\n|\r/).filter((line) => line.length > 0)

            if (lines.length > 0) {
              const lastLineComplete =
                transferLineRegex.test(lines[lines.length - 1]) &&
                etaRegex.test(lines[lines.length - 1])
              const linesToProcess = lastLineComplete ? lines : lines.slice(0, -1)
              outputBuffer = lastLineComplete ? '' : lines[lines.length - 1]

              for (const line of linesToProcess) {
                const progressMatch = line.match(transferLineRegex)
                if (progressMatch && progressMatch[1]) {
                  const currentProgress = parseInt(progressMatch[1], 10)
                  if (currentProgress >= (currentItemState.progress ?? 0)) {
                    const speedMatch = line.match(speedRegex)
                    const etaMatch = line.match(etaRegex)
                    const speed = speedMatch?.[1] || currentItemState.speed
                    const eta = etaMatch?.[1] || currentItemState.eta
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
                    `[DownProc] Rclone (${item.releaseName}): Auth Error/Failed with mirror`
                  )
                  this.cancelDownload(item.releaseName, 'Error', 'Auth failed with mirror')
                }
                if (line.includes("doesn't support hash type")) {
                  console.warn(
                    `[DownProc] Rclone (${item.releaseName}): Hash type not supported with mirror`
                  )
                }
              }
            }
          })

          try {
            await rcloneProcess // Wait for the process to complete

            // Check final state after mirror download completes
            const finalItemState = this.queueManager.findItem(item.releaseName)
            if (!finalItemState || finalItemState.status !== 'Downloading') {
              console.log(
                `[DownProc] Mirror download process for ${item.releaseName} finished, but final status is ${finalItemState?.status}. Not proceeding to extraction.`
              )
              // Clean up
              if (this.activeDownloads.has(item.releaseName)) {
                this.activeDownloads.delete(item.releaseName)
                this.queueManager.updateItem(item.releaseName, { pid: undefined })
              }
              return { success: false, startExtraction: false, finalState: finalItemState }
            }

            console.log(
              `[DownProc] Mirror download process finished successfully for ${item.releaseName}.`
            )
            this.activeDownloads.delete(item.releaseName)

            // Mirror downloads are already extracted, so mark as completed
            // this.queueManager.updateItem(item.releaseName, {
            //   status: 'Completed',
            //   progress: 100,
            //   pid: undefined
            // })
            // this.debouncedEmitUpdate() // Update UI to reflect completion
            this.updateItemStatus(
              item.releaseName,
              'Completed',
              100,
              undefined,
              undefined,
              undefined,
              100
            )

            // Mirror files are already extracted, no extraction needed
            return {
              success: true,
              startExtraction: false,
              finalState: this.queueManager.findItem(item.releaseName)
            }
          } catch (mirrorError: unknown) {
            console.error(
              `[DownProc] Mirror download failed for ${item.releaseName}, falling back to public endpoint:`,
              mirrorError
            )

            // Clean up mirror process
            if (this.activeDownloads.has(item.releaseName)) {
              this.activeDownloads.delete(item.releaseName)
              this.queueManager.updateItem(item.releaseName, { pid: undefined })
            }

            // Don't return here, fall through to public endpoint logic
          }
        } catch (configError) {
          console.error('[DownProc] Failed to use mirror config file:', configError)
          // Fall through to public endpoint logic
        }
      }
    }

    // Fall back to public endpoint if no mirror or mirror failed
    console.log(`[DownProc] Using public endpoint for ${item.releaseName}`)

    const gameNameHash = crypto
      .createHash('md5')
      .update(item.releaseName + '\n')
      .digest('hex')
    const source = `:http:/${gameNameHash}`

    // Get the appropriate null config path based on platform
    const nullConfigPath = process.platform === 'win32' ? 'NUL' : '/dev/null'

    try {
      rcloneProcess = execa(
        rclonePath,
        [
          'copy',
          source,
          downloadPath,
          '--config',
          nullConfigPath,
          '--http-url',
          this.vrpConfig.baseUri,
          '--no-check-certificate',
          '--progress',
          '--stats=1s',
          '--stats-one-line',
          ...(settingsService.getDownloadSpeedLimit() > 0
            ? [`--bwlimit`, `${settingsService.getDownloadSpeedLimit()}K`]
            : []),
          ...(settingsService.getUploadSpeedLimit() > 0
            ? [`--tpslimit`, `${settingsService.getUploadSpeedLimit()}`]
            : [])
        ],
        { all: true, buffer: false, windowsHide: true }
      )

      if (!rcloneProcess || !rcloneProcess.pid || !rcloneProcess.all) {
        throw new Error('Failed to start rclone process.')
      }

      this.activeDownloads.set(item.releaseName, rcloneProcess)
      this.queueManager.updateItem(item.releaseName, { pid: rcloneProcess.pid })

      console.log(
        `[DownProc] rclone process started for ${item.releaseName} with PID: ${rcloneProcess.pid}`
      )

      const transferLineRegex = /, (\d+)%, /
      const speedRegex = /, (\d+\.\d+ \S+?B\/s),/
      const etaRegex = /, ETA (\S+)/

      let outputBuffer = ''
      rcloneProcess.all.on('data', (data: Buffer) => {
        const currentItemState = this.queueManager.findItem(item.releaseName)
        if (!currentItemState || currentItemState.status !== 'Downloading') {
          // Item removed or status changed (e.g., cancelled), stop processing data
          console.warn(
            `[DownProc] Item ${item.releaseName} state changed to ${currentItemState?.status} during download. Stopping data processing.`
          )
          const proc = this.activeDownloads.get(item.releaseName)
          if (proc) {
            proc.all?.removeAllListeners() // Remove listeners
            proc.kill('SIGTERM') // Attempt to kill
            this.activeDownloads.delete(item.releaseName) // Remove tracking
          }
          return
        }
        outputBuffer += data.toString()
        const lines = outputBuffer.split(/\r\n|\n|\r/).filter((line) => line.length > 0)

        if (lines.length > 0) {
          const lastLineComplete =
            transferLineRegex.test(lines[lines.length - 1]) &&
            etaRegex.test(lines[lines.length - 1])
          const linesToProcess = lastLineComplete ? lines : lines.slice(0, -1)
          outputBuffer = lastLineComplete ? '' : lines[lines.length - 1]

          for (const line of linesToProcess) {
            // console.log(`[DownProc Raw Line] ${item.releaseName}: ${line}`);
            const progressMatch = line.match(transferLineRegex)
            if (progressMatch && progressMatch[1]) {
              const currentProgress = parseInt(progressMatch[1], 10)
              if (currentProgress >= (currentItemState.progress ?? 0)) {
                // Use >= to ensure 0% gets logged
                const speedMatch = line.match(speedRegex)
                const etaMatch = line.match(etaRegex)
                const speed = speedMatch?.[1] || currentItemState.speed
                const eta = etaMatch?.[1] || currentItemState.eta
                // console.log(`[DownProc Parsed] ${currentProgress}%, Speed: ${speed}, ETA: ${eta}`);
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
              console.error(`[DownProc] Rclone (${item.releaseName}): Auth Error/Failed`)
              this.cancelDownload(item.releaseName, 'Error', 'Auth failed (check VRP password?)')
              // Don't return, let the main error handler catch the process exit
            }
            if (line.includes("doesn't support hash type")) {
              console.warn(`[DownProc] Rclone (${item.releaseName}): Hash type not supported`)
            }
          }
        }
      })

      await rcloneProcess // Wait for the process to complete

      // Check final state *after* await completes
      const finalItemState = this.queueManager.findItem(item.releaseName)
      if (!finalItemState || finalItemState.status !== 'Downloading') {
        console.log(
          `[DownProc] Download process for ${item.releaseName} finished, but final status is ${finalItemState?.status}. Not proceeding to extraction.`
        )
        // Clean up just in case
        if (this.activeDownloads.has(item.releaseName)) {
          this.activeDownloads.delete(item.releaseName)
          this.queueManager.updateItem(item.releaseName, { pid: undefined })
        }
        return { success: false, startExtraction: false, finalState: finalItemState } // Indicate failure/cancellation
      }

      console.log(`[DownProc] rclone process finished successfully for ${item.releaseName}.`)
      this.activeDownloads.delete(item.releaseName)
      this.queueManager.updateItem(item.releaseName, { pid: undefined })

      // Signal success and intent to start extraction
      return { success: true, startExtraction: true, finalState: finalItemState }
    } catch (error: unknown) {
      const isExecaError = (err: unknown): err is ExecaError =>
        typeof err === 'object' && err !== null && 'shortMessage' in err
      const currentItemState = this.queueManager.findItem(item.releaseName)
      const statusBeforeCatch = currentItemState?.status ?? 'Unknown'

      // Handle intentional cancellation (SIGTERM)
      if (isExecaError(error) && error.exitCode === 143) {
        console.log(
          `[DownProc Catch] Ignoring expected SIGTERM (143) for ${item.releaseName}. Status: ${statusBeforeCatch}`
        )
        // Status should already be set by cancelDownload. Ensure cleanup.
        if (this.activeDownloads.has(item.releaseName)) {
          this.activeDownloads.delete(item.releaseName)
          this.queueManager.updateItem(item.releaseName, { pid: undefined })
        }
        return { success: false, startExtraction: false, finalState: currentItemState } // Return current state
      }

      // Handle unexpected errors
      console.error(
        `[DownProc Catch] Unexpected error for ${item.releaseName}. Status: ${statusBeforeCatch}. Error:`,
        error
      )
      if (this.activeDownloads.has(item.releaseName)) {
        this.activeDownloads.delete(item.releaseName)
        this.queueManager.updateItem(item.releaseName, { pid: undefined })
      }

      let errorMessage = 'Download failed.'
      if (isExecaError(error)) {
        if (error.isCanceled) {
          // Should be caught by SIGTERM check, but handle as fallback
          if (statusBeforeCatch !== 'Cancelled' && statusBeforeCatch !== 'Error') {
            console.log(
              `[DownProc Catch] Download cancelled (isCanceled flag). Status: ${statusBeforeCatch}`
            )
            this.updateItemStatus(item.releaseName, 'Cancelled', currentItemState?.progress ?? 0)
          } else {
            console.log(
              `[DownProc Catch] Download cancelled (isCanceled flag), status already ${statusBeforeCatch}.`
            )
          }
          return {
            success: false,
            startExtraction: false,
            finalState: this.queueManager.findItem(item.releaseName)
          }
        }
        errorMessage = error.shortMessage || error.message
        const output = error.all || error.stderr || error.stdout || ''
        const lastLines = (typeof output === 'string' ? output : output.toString())
          .split('\n')
          .slice(-5)
          .join('\n')
        if (lastLines) errorMessage += `\n...\n${lastLines}`
      } else if (error instanceof Error) {
        errorMessage = error.message
      } else {
        errorMessage = String(error)
      }
      errorMessage = errorMessage.substring(0, 500)

      // Update status to Error only if it wasn't already handled
      if (statusBeforeCatch !== 'Cancelled' && statusBeforeCatch !== 'Error') {
        this.updateItemStatus(
          item.releaseName,
          'Error',
          currentItemState?.progress ?? 0,
          errorMessage
        )
      } else {
        console.log(
          `[DownProc Catch] Download error occurred for ${item.releaseName}, but status was already ${statusBeforeCatch}. Error: ${errorMessage}`
        )
        if (statusBeforeCatch === 'Error') {
          // Update error message if already in error state
          this.queueManager.updateItem(item.releaseName, { error: errorMessage })
          this.debouncedEmitUpdate()
        }
      }

      return {
        success: false,
        startExtraction: false,
        finalState: this.queueManager.findItem(item.releaseName)
      } // Indicate failure
    }
  }

  // Method to check if a download is active
  public isDownloadActive(releaseName: string): boolean {
    return this.activeDownloads.has(releaseName)
  }
}
