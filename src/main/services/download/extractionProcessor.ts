import { join, basename } from 'path'
import { promises as fs, existsSync } from 'fs'
import { execa, ExecaError } from 'execa'
import { QueueManager } from './queueManager'
import dependencyService from '../dependencyService'
import { DownloadItem, DownloadStatus } from '@shared/types'

// Type for VRP config - reuse or import
interface VrpConfig {
  baseUri?: string
  password?: string
}

export class ExtractionProcessor {
  private activeExtractions: Map<string, ReturnType<typeof execa>> = new Map()
  private queueManager: QueueManager
  private vrpConfig: VrpConfig | null = null
  private debouncedEmitUpdate: () => void

  private static isExecaError = (err: unknown): err is ExecaError =>
    typeof err === 'object' && err !== null && 'shortMessage' in err

  constructor(queueManager: QueueManager, debouncedEmitUpdate: () => void) {
    this.queueManager = queueManager
    this.debouncedEmitUpdate = debouncedEmitUpdate
  }

  public setVrpConfig(config: VrpConfig | null): void {
    this.vrpConfig = config
  }

  // Centralized update method (could potentially be shared, but keep separate for now)
  private updateItemStatus(
    releaseName: string,
    status: DownloadStatus,
    progress: number,
    error?: string,
    speed?: string, // Keep signature consistent? Might not be used here.
    eta?: string, // Keep signature consistent?
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
    }
  }

  public cancelExtraction(releaseName: string): void {
    const extractionProcess = this.activeExtractions.get(releaseName)
    if (extractionProcess) {
      console.log(`[ExtractProc] Cancelling extraction: ${releaseName}`)
      try {
        if (extractionProcess.kill('SIGTERM')) {
          console.log(`[ExtractProc] Sent SIGTERM to extraction: ${releaseName}.`)
          const killTimeout = setTimeout(() => {
            if (this.activeExtractions.has(releaseName)) {
              console.warn(`[ExtractProc] Extraction ${releaseName} timed out, sending SIGKILL.`)
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
          console.warn(`[ExtractProc] Failed to send SIGTERM to extraction ${releaseName}.`)
          this.activeExtractions.delete(releaseName)
          this.queueManager.updateItem(releaseName, { pid: undefined })
        }
      } catch (killError) {
        console.error(`[ExtractProc] Error killing extraction ${releaseName}:`, killError)
        this.activeExtractions.delete(releaseName)
        this.queueManager.updateItem(releaseName, { pid: undefined })
      }
    } else {
      console.log(`[ExtractProc] No active extraction found to cancel for ${releaseName}.`)
      // If no process found, ensure the item status reflects an error if it was 'Extracting'
      const item = this.queueManager.findItem(releaseName)
      if (item && item.status === 'Extracting') {
        this.updateItemStatus(releaseName, 'Error', item.progress ?? 100, 'Extraction process lost')
      }
    }
    // Status update (e.g., to Cancelled) should be handled by the caller (e.g., DownloadService.cancelUserRequest)
    // after calling this cancellation method.
  }

  private async extractNestedArchives(baseExtractPath: string, releaseName: string): Promise<void> {
    console.log(
      `[ExtractProc] Checking for nested archives in ${baseExtractPath} for ${releaseName}`
    )

    const sevenZipPath = dependencyService.get7zPath()
    if (!sevenZipPath) {
      console.error(
        `[ExtractProc] 7zip path not found for nested extraction of ${releaseName}. Skipping nested.`
      )
      return
    }

    try {
      const itemsInDir = await fs.readdir(baseExtractPath, { withFileTypes: true })
      const nestedArchives = itemsInDir
        .filter(
          (dirent) =>
            dirent.isFile() && dirent.name.endsWith('.7z') && !/\.7z\.\d+$/.test(dirent.name)
        )
        .map((dirent) => dirent.name)

      if (nestedArchives.length === 0) {
        console.log(
          `[ExtractProc] No nested .7z archives found in ${baseExtractPath} for ${releaseName}.`
        )
        return
      }

      console.log(
        `[ExtractProc] Found ${nestedArchives.length} nested .7z archive(s) for ${releaseName}: ${nestedArchives.join(', ')}`
      )

      for (const archiveName of nestedArchives) {
        const nestedArchivePath = join(baseExtractPath, archiveName)
        console.log(`[ExtractProc] Starting extraction for nested archive: ${nestedArchivePath}.`)

        let nestedProcess: ReturnType<typeof execa> | null = null
        try {
          nestedProcess = execa(sevenZipPath, ['x', nestedArchivePath, '-aoa', '-bsp1', '-y'], {
            cwd: baseExtractPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            all: true,
            buffer: false,
            windowsHide: true
          })

          if (!nestedProcess || !nestedProcess.pid || !nestedProcess.all) {
            throw new Error(`Failed to start 7zip process for nested archive ${archiveName}.`)
          }

          console.log(
            `[ExtractProc] 7zip (nested) started for ${archiveName}, PID: ${nestedProcess.pid}. Output dir: ${baseExtractPath}`
          )

          let nestedOutputCombined = ''
          if (nestedProcess.all) {
            nestedProcess.all.on('data', (data: Buffer) => {
              const outputChunk = data.toString()
              nestedOutputCombined += outputChunk
            })
          }

          const result = await nestedProcess
          console.log(
            `[ExtractProc] Nested extraction complete for ${archiveName}. Exit code: ${result.exitCode}`
          )

          if (nestedOutputCombined.includes('ERROR: Wrong password')) {
            console.error(`[ExtractProc Nested ${archiveName}] Wrong password detected in output.`)
            continue
          }
          if (
            nestedOutputCombined.includes('ERROR: Data Error') ||
            nestedOutputCombined.includes('CRC Failed')
          ) {
            console.error(`[ExtractProc Nested ${archiveName}] Data/CRC error detected in output.`)
            continue
          }

          try {
            await fs.unlink(nestedArchivePath)
            console.log(`[ExtractProc] Deleted nested archive: ${nestedArchivePath}`)
          } catch (unlinkError) {
            console.warn(
              `[ExtractProc] Failed to delete nested archive ${nestedArchivePath}:`,
              unlinkError
            )
          }
        } catch (nestedError: unknown) {
          console.error(
            `[ExtractProc] Error during extraction of nested archive ${archiveName}:`,
            nestedError
          )
          if (ExtractionProcessor.isExecaError(nestedError)) {
            const execaErr = nestedError as ExecaError
            const output = String(execaErr.all || execaErr.stderr || execaErr.stdout || '')
            if (output.includes('ERROR: Wrong password')) {
              console.error(`[ExtractProc Nested ${archiveName}] Wrong password (from ExecaError).`)
            } else if (output.includes('ERROR: Data Error') || output.includes('CRC Failed')) {
              console.error(`[ExtractProc Nested ${archiveName}] Data/CRC error (from ExecaError).`)
            } else {
              console.error(
                `[ExtractProc Nested ${archiveName} Error Output]: ${output.substring(0, 1000)}`
              )
            }
          }
        }
      }
    } catch (err) {
      console.error(
        `[ExtractProc] Error scanning for nested archives for ${releaseName} in ${baseExtractPath}:`,
        err
      )
    }
  }

  // Returns true on success, false on failure
  public async startExtraction(item: DownloadItem): Promise<boolean> {
    console.log(`[ExtractProc] Starting extraction: ${item.releaseName}`)
    const downloadPath = item.downloadPath // Path comes from the DownloadItem

    if (!downloadPath || !existsSync(downloadPath)) {
      console.error(`[ExtractProc] Invalid download path for ${item.releaseName}: ${downloadPath}`)
      this.updateItemStatus(
        item.releaseName,
        'Error',
        100,
        `Invalid download path: ${downloadPath}`
      )
      return false
    }
    if (!dependencyService.getStatus().sevenZip.ready) {
      console.error(`[ExtractProc] 7zip dependency not ready for ${item.releaseName}.`)
      this.updateItemStatus(item.releaseName, 'Error', 100, '7zip not ready')
      return false
    }

    let files: string[]
    try {
      files = await fs.readdir(downloadPath)
    } catch (readDirError: unknown) {
      let errorMsg = 'Cannot read download dir'
      if (readDirError instanceof Error)
        errorMsg = `Cannot read download dir: ${readDirError.message}`
      console.error(`[ExtractProc] Error reading download dir ${downloadPath}:`, readDirError)
      this.updateItemStatus(item.releaseName, 'Error', 100, errorMsg.substring(0, 500))
      return false
    }

    const archivePart1 = files.find((f) => f.endsWith('.7z.001'))
    if (!archivePart1) {
      console.error(`[ExtractProc] .7z.001 not found in ${downloadPath} for ${item.releaseName}.`)
      this.updateItemStatus(item.releaseName, 'Error', 100, `.7z.001 not found in ${downloadPath}`)
      return false
    }
    const archivePath = join(downloadPath, archivePart1)

    // Update status via internal method
    this.updateItemStatus(item.releaseName, 'Extracting', 100, undefined, undefined, undefined, 0)

    let decodedPassword = ''
    if (!this.vrpConfig?.password) {
      console.error(`[ExtractProc] Missing VRP password for extraction of ${item.releaseName}.`)
      this.updateItemStatus(item.releaseName, 'Error', 100, 'Missing VRP password for extraction')
      return false
    }
    try {
      // Use internal vrpConfig
      decodedPassword = Buffer.from(this.vrpConfig.password, 'base64').toString('utf-8')
    } catch (e: unknown) {
      console.error(`[ExtractProc] Failed to decode VRP password for ${item.releaseName}.`, e)
      this.updateItemStatus(item.releaseName, 'Error', 100, 'Invalid VRP password')
      return false
    }

    const sevenZipPath = dependencyService.get7zPath()
    if (!sevenZipPath) {
      console.error(`[ExtractProc] 7zip path not found for ${item.releaseName}.`)
      this.updateItemStatus(
        item.releaseName,
        'Error',
        100,
        '7zip path not found',
        undefined,
        undefined,
        0
      )
      return false
    }

    let sevenZipProcess: ReturnType<typeof execa> | null = null
    try {
      sevenZipProcess = execa(
        sevenZipPath,
        ['x', archivePath, '-aoa', '-bsp1', '-y', `-p${decodedPassword}`],
        {
          cwd: downloadPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          all: true,
          buffer: false,
          windowsHide: true
        }
      )

      if (!sevenZipProcess || !sevenZipProcess.pid || !sevenZipProcess.all) {
        throw new Error('Failed to start 7zip process.')
      }

      this.activeExtractions.set(item.releaseName, sevenZipProcess)
      this.queueManager.updateItem(item.releaseName, { pid: sevenZipProcess.pid })

      console.log(`[ExtractProc] 7zip started for ${item.releaseName}, PID: ${sevenZipProcess.pid}`)

      const progressRegex = /^\s*(\d+)%/
      let outputBuffer = ''

      sevenZipProcess.all.on('data', (data: Buffer) => {
        const currentItemState = this.queueManager.findItem(item.releaseName)
        if (!currentItemState || currentItemState.status !== 'Extracting') {
          console.warn(
            `[ExtractProc] Extraction data received for ${item.releaseName}, but state is ${currentItemState?.status}. Stopping data processing.`
          )
          const proc = this.activeExtractions.get(item.releaseName)
          if (proc) {
            proc.all?.removeAllListeners()
            proc.kill('SIGTERM')
            this.activeExtractions.delete(item.releaseName)
            this.queueManager.updateItem(item.releaseName, { pid: undefined })
          }
          return
        }

        outputBuffer += data.toString()

        // --- New Progress Parsing Logic ---
        // Determine the most current "display line" for progress.
        // This is typically the content after the last newline, and then after the last carriage return in that segment.
        let lineForProgress = outputBuffer
        const lastNewlineIndex = lineForProgress.lastIndexOf('\n')
        if (lastNewlineIndex !== -1) {
          // Consider only the content after the last newline for current progress display
          lineForProgress = lineForProgress.substring(lastNewlineIndex + 1)
        }
        // Now, from this potentially partial line, find content after the last carriage return
        const lastCarriageReturnIndex = lineForProgress.lastIndexOf('\r')
        if (lastCarriageReturnIndex !== -1) {
          lineForProgress = lineForProgress.substring(lastCarriageReturnIndex + 1)
        }
        // lineForProgress now holds the most up-to-date segment that would be visible on a terminal line.
        // Trim it to remove leading/trailing whitespace that might affect the regex.
        const trimmedLineForProgress = lineForProgress.trim()

        if (trimmedLineForProgress.length > 0) {
          const progressMatch = trimmedLineForProgress.match(progressRegex) // progressRegex = /^\s*(\d+)%/
          if (progressMatch && progressMatch[1]) {
            const currentProgress = parseInt(progressMatch[1], 10)
            if (currentProgress >= (currentItemState.extractProgress ?? 0)) {
              const updated = this.queueManager.updateItem(item.releaseName, {
                extractProgress: currentProgress
              })
              if (updated) this.debouncedEmitUpdate()
            }
          }
        }
        // --- End New Progress Parsing Logic ---

        // --- Modified Full Line Processing for Errors ---
        let newlineIndexWhileLoop // Renamed to avoid conflict with lastNewlineIndex
        while ((newlineIndexWhileLoop = outputBuffer.indexOf('\n')) >= 0) {
          const line = outputBuffer.substring(0, newlineIndexWhileLoop).trim()
          outputBuffer = outputBuffer.substring(newlineIndexWhileLoop + 1)

          // Previous diagnostic logs related to line processing for progress are removed here.

          if (line.length > 0) {
            // Progress parsing is now handled above by the "New Progress Parsing Logic".
            // Error checking remains.
            if (line.includes('ERROR: Wrong password')) {
              console.error(`[ExtractProc] 7zip (${item.releaseName}): Wrong password.`)
              this.cancelExtraction(item.releaseName) // Stop the process
              this.updateItemStatus(
                item.releaseName,
                'Error',
                100,
                'Wrong password',
                undefined,
                undefined,
                currentItemState.extractProgress ?? 0
              )
              // Let the main catch block handle the process exit eventually
            }
            if (line.includes('ERROR: Data Error') || line.includes('CRC Failed')) {
              console.error(`[ExtractProc] 7zip (${item.releaseName}): Data/CRC error.`)
              this.cancelExtraction(item.releaseName) // Stop the process
              this.updateItemStatus(
                item.releaseName,
                'Error',
                100,
                'Data/CRC error',
                undefined,
                undefined,
                currentItemState.extractProgress ?? 0
              )
              // Let the main catch block handle the process exit eventually
            }
          }
        }
      })

      await sevenZipProcess // Wait for completion

      // Check final state *after* await
      const finalItemState = this.queueManager.findItem(item.releaseName)
      if (!finalItemState || finalItemState.status !== 'Extracting') {
        console.log(
          `[ExtractProc] Extraction finished for ${item.releaseName}, but final status is ${finalItemState?.status}.`
        )
        if (this.activeExtractions.has(item.releaseName)) {
          this.activeExtractions.delete(item.releaseName)
          this.queueManager.updateItem(item.releaseName, { pid: undefined })
        }
        return false // Indicate failure/cancellation
      }

      console.log(`[ExtractProc] Extraction complete: ${item.releaseName} in ${downloadPath}`)
      this.activeExtractions.delete(item.releaseName)
      this.queueManager.updateItem(item.releaseName, { pid: undefined })

      // --- Delete archive files --- START
      console.log(`[ExtractProc] Deleting archive parts for ${item.releaseName}`)
      try {
        const filesInDir = await fs.readdir(downloadPath)
        const baseArchiveName = basename(archivePath).split('.7z.')[0]
        const archiveParts = filesInDir.filter(
          (file) => file.startsWith(baseArchiveName) && file.includes('.7z.')
        )
        if (archiveParts.length > 0) {
          console.log(`[ExtractProc] Deleting: ${archiveParts.join(', ')}`)
          for (const part of archiveParts) {
            const partPath = join(downloadPath, part)
            try {
              await fs.unlink(partPath)
              console.log(`[ExtractProc] Deleted: ${partPath}`)
            } catch (unlinkError: unknown) {
              console.warn(`[ExtractProc] Failed to delete ${partPath}:`, unlinkError)
            }
          }
        } else {
          console.log(`[ExtractProc] No *.7z.* parts found for ${baseArchiveName}.`)
        }
      } catch (deleteError: unknown) {
        console.error(
          `[ExtractProc] Error during archive deletion for ${item.releaseName}:`,
          deleteError
        )
      }
      // --- Delete archive files --- END

      // --- Flatten single root folder if it matches releaseName --- START
      const rootFolderPath = join(downloadPath, item.releaseName)
      try {
        if (existsSync(rootFolderPath)) {
          const stats = await fs.stat(rootFolderPath)
          if (stats.isDirectory()) {
            console.log(
              `[ExtractProc] Found directory matching release name: ${rootFolderPath}. Attempting to flatten.`
            )
            const rootFolderContents = await fs.readdir(rootFolderPath)
            if (rootFolderContents.length > 0) {
              for (const contentName of rootFolderContents) {
                const oldPath = join(rootFolderPath, contentName)
                const newPath = join(downloadPath, contentName)
                try {
                  // Check if newPath already exists and handle potential conflicts (simple overwrite or log)
                  // For now, we'll attempt to rename, which might fail if newPath exists.
                  if (existsSync(newPath)) {
                    console.warn(
                      `[ExtractProc] Target path ${newPath} already exists. Skipping move for ${oldPath}. This might lead to an incomplete flatten operation if the root folder cannot be emptied.`
                    )
                  } else {
                    await fs.rename(oldPath, newPath)
                    console.log(`[ExtractProc] Moved: ${oldPath} -> ${newPath}`)
                  }
                } catch (moveError: unknown) {
                  let message = 'Unknown error'
                  if (moveError instanceof Error) {
                    message = moveError.message
                  }
                  console.warn(`[ExtractProc] Could not move ${oldPath} to ${newPath}: ${message}.`)
                }
              }
              // After attempting to move all contents, try to remove the directory
              // It will only be removed if it's now empty.
              const remainingContents = await fs.readdir(rootFolderPath)
              if (remainingContents.length === 0) {
                await fs.rmdir(rootFolderPath)
                console.log(`[ExtractProc] Removed original root folder: ${rootFolderPath}`)
              } else {
                console.warn(
                  `[ExtractProc] Original root folder ${rootFolderPath} is not empty after moving contents, not removing. Contents: ${remainingContents.join(', ')}`
                )
              }
            } else {
              // The directory matching releaseName is empty, so just remove it.
              console.log(
                `[ExtractProc] Directory ${rootFolderPath} matching release name is empty. Removing it.`
              )
              await fs.rmdir(rootFolderPath)
            }
          }
        }
      } catch (flattenError: unknown) {
        console.warn(
          `[ExtractProc] Error during root folder flattening for ${item.releaseName}:`,
          flattenError
        )
        // Non-critical error, just log it
      }
      // --- Flatten single root folder if it matches releaseName --- END

      // --- Extract nested .7z archives --- START
      await this.extractNestedArchives(downloadPath, item.releaseName)
      // --- Extract nested .7z archives --- END

      // Update final status to Completed
      this.updateItemStatus(
        item.releaseName,
        'Completed',
        100,
        undefined,
        undefined,
        undefined,
        100
      )
      return true // Indicate success
    } catch (error: unknown) {
      const currentItemState = this.queueManager.findItem(item.releaseName)
      const statusBeforeCatch = currentItemState?.status ?? 'Unknown'

      // Handle intentional termination
      if (
        ExtractionProcessor.isExecaError(error) &&
        (error.signal === 'SIGTERM' ||
          error.signal === 'SIGKILL' ||
          error.exitCode === 143 || // Standard exit code for SIGTERM
          error.exitCode === 137) // Standard exit code for SIGKILL
      ) {
        console.log(
          `[ExtractProc Catch] Ignoring termination signal (${error.signal || 'Code ' + error.exitCode}) for ${item.releaseName}. Status: ${statusBeforeCatch}`
        )
        if (this.activeExtractions.has(item.releaseName)) {
          this.activeExtractions.delete(item.releaseName)
          this.queueManager.updateItem(item.releaseName, { pid: undefined })
        }
        // Don't update status here, cancellation initiated it
        return false // Indicate failure/cancellation
      }

      // Handle unexpected errors
      console.error(`[ExtractProc Catch] Extraction error for ${item.releaseName}:`, error)
      if (this.activeExtractions.has(item.releaseName)) {
        this.activeExtractions.delete(item.releaseName)
        this.queueManager.updateItem(item.releaseName, { pid: undefined })
      }

      let errorMessage = 'Extraction failed.'
      if (ExtractionProcessor.isExecaError(error)) {
        const output = String(error.all || error.stderr || error.stdout || '')
        if (output.includes('ERROR: Wrong password')) {
          errorMessage = 'Wrong password'
        } else if (output.includes('ERROR: Data Error') || output.includes('CRC Failed')) {
          errorMessage = 'Data/CRC error'
        } else {
          errorMessage = error.shortMessage || error.message
        }
        const lastLines = output.split('\n').slice(-3).join('\n')
        if (lastLines && errorMessage !== 'Wrong password' && errorMessage !== 'Data/CRC error') {
          errorMessage += `\n...\n${lastLines}`
        }
      } else if (error instanceof Error) {
        errorMessage = error.message
      } else {
        errorMessage = String(error)
      }
      errorMessage = errorMessage.substring(0, 500)

      // Update status to Error only if it wasn't already handled (e.g., by cancellation)
      if (statusBeforeCatch === 'Extracting') {
        // Check if it was actively extracting before error
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
          `[ExtractProc Catch] Extraction error for ${item.releaseName}, but status was ${statusBeforeCatch}. Error: ${errorMessage}`
        )
        // If already Error, maybe update message? If Cancelled, leave it.
        if (statusBeforeCatch === 'Error') {
          this.queueManager.updateItem(item.releaseName, { error: errorMessage })
          this.debouncedEmitUpdate()
        }
      }
      return false // Indicate failure
    }
  }

  // Method to check if extraction is active
  public isExtractionActive(releaseName: string): boolean {
    return this.activeExtractions.has(releaseName)
  }
}
