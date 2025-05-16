import { app, shell } from 'electron'
import { EventEmitter } from 'events'
import axios from 'axios'
import { UpdateInfo } from '@shared/types'

class UpdateService extends EventEmitter {
  private currentVersion: string = app.getVersion()

  constructor() {
    super()
  }

  /**
   * Initialize the update service
   */
  public initialize(): void {
    console.log('Update service initialized')
  }

  /**
   * Check for updates by fetching the latest release from GitHub
   */
  public async checkForUpdates(): Promise<void> {
    console.log('Checking for updates...')

    try {
      this.emit('checking-for-update')

      // Get latest release from GitHub API
      const response = await axios.get(
        'https://api.github.com/repos/jimzrt/apprenticeVr/releases/latest'
      )

      if (response.status === 200) {
        const latestRelease = response.data
        const latestVersion = latestRelease.tag_name.replace('v', '') // Remove 'v' prefix if present

        console.log(`Current version: ${this.currentVersion}, Latest version: ${latestVersion}`)

        // Check if versions are different (needs improvement for semantic versioning)
        if (latestVersion !== this.currentVersion) {
          // Prepare update info object
          const updateInfo: UpdateInfo = {
            version: latestVersion,
            releaseNotes: latestRelease.body,
            releaseDate: latestRelease.published_at
          }

          // Find platform-specific assets
          const assets = latestRelease.assets || []
          let downloadUrl = ''

          if (process.platform === 'win32') {
            const windowsAsset = assets.find((asset) => asset.name.endsWith('-setup.exe'))
            if (windowsAsset) downloadUrl = windowsAsset.browser_download_url
          } else if (process.platform === 'darwin') {
            const macAsset = assets.find((asset) => asset.name.endsWith('.dmg'))
            if (macAsset) downloadUrl = macAsset.browser_download_url
          } else if (process.platform === 'linux') {
            const linuxAsset = assets.find((asset) => asset.name.endsWith('.AppImage'))
            if (linuxAsset) downloadUrl = linuxAsset.browser_download_url
          }

          // Add download URL to update info
          if (downloadUrl) {
            updateInfo.downloadUrl = downloadUrl
          }

          this.emit('update-available', updateInfo)
        } else {
          console.log('No updates available')
        }
      } else {
        throw new Error(`GitHub API returned status ${response.status}`)
      }
    } catch (error) {
      console.error('Error checking for updates:', error)
      this.emit('error', error)
    }
  }

  /**
   * Open download URL in browser
   */
  public openDownloadPage(url: string): void {
    console.log('Opening download page:', url)
    shell.openExternal(url)
  }
}

export default new UpdateService()
