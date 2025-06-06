import { app, shell } from 'electron'
import { EventEmitter } from 'events'
import axios from 'axios'
import { UpdateInfo, CommitInfo } from '@shared/types'
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
   * Fetch commits between two versions
   */
  private async fetchCommitsBetweenVersions(
    currentVersion: string,
    latestVersion: string
  ): Promise<CommitInfo[]> {
    try {
      console.log(`Fetching commits between v${currentVersion} and v${latestVersion}`)

      // Get the commit SHA for the current version tag
      const currentTagResponse = await axios.get(
        `https://api.github.com/repos/jimzrt/apprenticeVr/git/ref/tags/v${currentVersion}`
      )

      if (currentTagResponse.status !== 200) {
        console.warn(`Could not find tag v${currentVersion}, falling back to commit comparison`)
        return []
      }

      const currentTagSha = currentTagResponse.data.object.sha

      // Get commits since the current version
      const commitsResponse = await axios.get(
        `https://api.github.com/repos/jimzrt/apprenticeVr/commits?since=${new Date(
          Date.now() - 365 * 24 * 60 * 60 * 1000
        ).toISOString()}&per_page=100`
      )

      if (commitsResponse.status !== 200) {
        console.warn('Could not fetch commits')
        return []
      }

      const allCommits = commitsResponse.data
      const commits: CommitInfo[] = []

      // Find commits between current tag and latest
      let reachedCurrentVersion = false
      for (const commit of allCommits) {
        // Stop when we reach the current version's commit
        if (commit.sha === currentTagSha || commit.sha.startsWith(currentTagSha.substring(0, 7))) {
          reachedCurrentVersion = true
          break
        }

        // Skip merge commits to keep changelog clean
        if (commit.parents && commit.parents.length <= 1) {
          commits.push({
            sha: commit.sha.substring(0, 7),
            message: commit.commit.message.split('\n')[0], // First line only
            author: commit.commit.author.name,
            date: commit.commit.author.date,
            url: commit.html_url
          })
        }
      }

      // If we didn't find the current version tag, try alternative approach
      if (!reachedCurrentVersion && commits.length === 0) {
        console.log('Using alternative commit fetching approach')
        // Get recent commits (last 20) as fallback
        const recentCommits = allCommits.slice(0, 20)
        for (const commit of recentCommits) {
          if (commit.parents && commit.parents.length <= 1) {
            commits.push({
              sha: commit.sha.substring(0, 7),
              message: commit.commit.message.split('\n')[0],
              author: commit.commit.author.name,
              date: commit.commit.author.date,
              url: commit.html_url
            })
          }
        }
      }

      console.log(`Found ${commits.length} commits between versions`)
      return commits.reverse() // Show oldest to newest
    } catch (error) {
      console.error('Error fetching commits between versions:', error)
      return []
    }
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

          // Fetch commits between versions
          const commits = await this.fetchCommitsBetweenVersions(this.currentVersion, latestVersion)
          if (commits.length > 0) {
            updateInfo.commits = commits
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
