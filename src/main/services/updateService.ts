import { app, shell } from 'electron'
import { EventEmitter } from 'events'
import axios from 'axios'
import { UpdateInfo } from '@shared/types'
import { compareVersions } from 'compare-versions'

class UpdateService extends EventEmitter {
  private currentVersion: string = app.getVersion()

  constructor() {
    super()
  }

  /**
   * Initialize the update service
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public initialize(): void {}

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

        if (compareVersions(latestVersion, this.currentVersion) > 0) {
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
            // Detect macOS architecture
            const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
            const macAsset = assets.find((asset) => asset.name.endsWith(`-${arch}.dmg`))
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

  /**
   * Open releases page in browser
   */
  public openReleasesPage(): void {
    const releasesUrl = 'https://github.com/jimzrt/apprenticeVr/releases'
    console.log('Opening releases page:', releasesUrl)
    shell.openExternal(releasesUrl)
  }

  /**
   * Open repository page in browser
   */
  public openRepositoryPage(): void {
    const repositoryUrl = 'https://github.com/jimzrt/apprenticeVr'
    console.log('Opening repository page:', repositoryUrl)
    shell.openExternal(repositoryUrl)
  }
}

export default new UpdateService()
