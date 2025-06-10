import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { LogsAPI } from '@shared/types'

class LogsService implements LogsAPI {
  public getLogFilePath(): string {
    return join(join(app.getPath('userData'), 'logs'), 'main.log')
  }

  private generateSimplePassword(): string {
    // Generate 3 random bytes and convert to base36 for a simple, short password
    return randomBytes(3).toString('hex').slice(0, 6)
  }

  async uploadCurrentLog(): Promise<{ url: string; password: string } | null> {
    const logFilePath = this.getLogFilePath()

    if (!existsSync(logFilePath)) {
      console.error('[LogsService] Log file not found at:', logFilePath)
      return null
    }

    try {
      console.log('[LogsService] Uploading log file to pub.microbin.eu...')

      // Read the log file content
      const logContent = readFileSync(logFilePath, 'utf-8')

      // Generate a simple password for this upload
      const password = this.generateSimplePassword()

      // Create FormData for multipart upload
      const formData = new FormData()
      formData.append('expiration', '3days')
      formData.append('burn_after', '0')
      formData.append('syntax_highlight', 'none')
      formData.append('privacy', 'readonly')
      formData.append('content', '')
      formData.append('plain_key', password)

      // Create a Blob for the file content and append it
      const fileBlob = new Blob([logContent], { type: 'application/octet-stream' })
      formData.append('file', fileBlob, 'apprenticevr-main.log')

      // Upload to pub.microbin.eu
      const response = await fetch('https://pub.microbin.eu/upload', {
        method: 'POST',
        body: formData
      })

      // Handle successful responses
      if (response.status === 302) {
        const location = response.headers.get('Location')
        if (location) {
          // If location is relative, make it absolute
          const shareableUrl = location.startsWith('http')
            ? location
            : `https://pub.microbin.eu${location}`
          console.log('[LogsService] Log file uploaded successfully:', shareableUrl)
          return { url: shareableUrl, password }
        } else {
          throw new Error('302 redirect received but no Location header found')
        }
      } else if (response.status === 200) {
        // Parse response body to extract URL from JavaScript
        const responseText = await response.text()

        // Look for the pattern: const url = (`` === "") ? `https://pub.microbin.eu/upload/...` : `/p/...`
        const urlMatch = responseText.match(
          /const url = \(`[^`]*` === ""\) \? `(https:\/\/pub\.microbin\.eu\/upload\/[^`]+)` : `[^`]*`/
        )

        if (urlMatch && urlMatch[1]) {
          const shareableUrl = urlMatch[1]
          console.log('[LogsService] Log file uploaded successfully:', shareableUrl)
          return { url: shareableUrl, password }
        } else {
          throw new Error('200 response received but could not extract URL from JavaScript')
        }
      } else {
        // Treat as error
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      console.error('[LogsService] Failed to upload log file:', error)
      return null
    }
  }
}

export default new LogsService()
