import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { LogsAPI } from '@shared/types'

class LogsService implements LogsAPI {
  public getLogFilePath(): string {
    return join(join(app.getPath('userData'), 'logs'), 'main.log')
  }

  async uploadCurrentLog(): Promise<string | null> {
    const logFilePath = this.getLogFilePath()

    if (!existsSync(logFilePath)) {
      console.error('[LogsService] Log file not found at:', logFilePath)
      return null
    }

    try {
      console.log('[LogsService] Uploading log file to filebin.net...')

      // Read the log file content
      const logContent = readFileSync(logFilePath, 'utf-8')

      // Generate a random bin ID (or you could create one via API first)
      const binId = Math.random().toString(36).substring(2, 15)
      const filename = 'apprenticevr-main.log'

      // Upload to filebin.net using POST to /binId/filename
      const response = await fetch(`https://filebin.net/${binId}/${filename}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: logContent
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`)
      }

      // The shareable URL is the bin URL
      const shareableUrl = `https://filebin.net/${binId}`

      console.log('[LogsService] Log file uploaded successfully:', shareableUrl)
      return shareableUrl
    } catch (error) {
      console.error('[LogsService] Failed to upload log file:', error)
      return null
    }
  }
}

export default new LogsService()
