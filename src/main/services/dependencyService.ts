import { app } from 'electron'
import { join } from 'path'
import { promises as fsPromises, existsSync, createWriteStream, chmodSync } from 'fs'
import axios, { AxiosProgressEvent } from 'axios'
import { execa } from 'execa'

// Type definitions
type ProgressCallback = (progress: { name: string; percentage: number }) => void

interface DependencyInfo {
  ready: boolean
  path: string | null
  error: string | null
}

interface RcloneDependencyInfo extends DependencyInfo {
  downloading: boolean
}
interface DependencyStatus {
  sevenZip: DependencyInfo
  rclone: RcloneDependencyInfo
}

// Simple interface for GitHub Release Asset
interface GitHubAsset {
  name: string
  browser_download_url: string
}

class DependencyService {
  private binDir: string // Directory within userData for downloaded binaries (like rclone)
  private resourcesBinDir: string // Directory within app resources for bundled binaries (like 7zip)
  private status: DependencyStatus
  private isInitializing: boolean
  private isInitialized: boolean

  constructor() {
    this.binDir = join(app.getPath('userData'), 'bin')
    // Path to bundled binaries - needs to handle packaged vs. dev environments
    this.resourcesBinDir = app.isPackaged
      ? join(process.resourcesPath, 'bin') // In packaged app, 'resources/bin'
      : join(app.getAppPath(), 'resources', 'bin') // In dev, 'projectRoot/resources/bin'

    this.status = {
      // 7zip status simplified - only checks existence
      sevenZip: { ready: false, path: null, error: null },
      rclone: { ready: false, path: null, error: null, downloading: false }
    }
    this.isInitializing = false
    this.isInitialized = false
  }

  async initialize(progressCallback?: ProgressCallback, force?: boolean): Promise<void> {
    if (this.isInitializing) {
      console.log('DependencyService already initializing, skipping.')
      return
    }
    if (!force && this.isInitialized) {
      console.log('DependencyService already initialized, skipping.')
      return
    }
    this.isInitializing = true
    console.log('Initializing DependencyService...')
    // Ensure userData bin directory exists for downloads like rclone
    await fsPromises.mkdir(this.binDir, { recursive: true })

    // Check for bundled 7zip
    this.checkBundled7zip()

    // Check or download rclone (this remains the same)
    await this.checkOrDownloadRclone(progressCallback)

    console.log('DependencyService initialization finished.')
    this.isInitializing = false
    this.isInitialized = true

    // Check if all dependencies are ready after initialization
    if (!this.status.sevenZip.ready || !this.status.rclone.ready) {
      // Throw an error or handle the situation where dependencies aren't ready
      const missing: ('7zip' | 'rclone')[] = []
      if (!this.status.sevenZip.ready) missing.push('7zip')
      if (!this.status.rclone.ready) missing.push('rclone')
      // Construct error message based on what failed
      let errorMessage = `Dependency setup failed. Missing or failed: ${missing.join(', ')}. `
      if (this.status.sevenZip.error) errorMessage += `7zip Error: ${this.status.sevenZip.error} `
      if (this.status.rclone.error) errorMessage += `Rclone Error: ${this.status.rclone.error}`

      console.error(errorMessage)
      throw new Error(errorMessage) // Propagate error to caller
    }
  }

  // --- 7zip ---

  // Updated to point to bundled location
  public get7zPath(): string | null {
    const platform = process.platform
    let platformDir: string
    let binaryName: string

    switch (platform) {
      case 'win32':
        platformDir = 'win32'
        binaryName = '7za.exe'
        break
      case 'linux':
        platformDir = 'linux'
        binaryName = '7zzs'
        break
      case 'darwin':
        platformDir = 'darwin'
        binaryName = '7zz'
        break
      default:
        console.error(`Unsupported platform for bundled 7zip: ${platform}`)
        return null // Or throw an error
    }

    const fullPath = join(this.resourcesBinDir, platformDir, binaryName)
    console.log(`Calculated 7zip path for ${platform}: ${fullPath}`)
    return fullPath
  }

  // New method to check for bundled 7zip
  private checkBundled7zip(): void {
    const expectedPath = this.get7zPath()
    this.status.sevenZip.path = expectedPath // Store the calculated path

    if (!expectedPath) {
      this.status.sevenZip.ready = false
      this.status.sevenZip.error = `Unsupported platform: ${process.platform}`
      return
    }

    if (existsSync(expectedPath)) {
      console.log(`Bundled 7zip found at ${expectedPath}`)
      this.status.sevenZip.ready = true
      this.status.sevenZip.error = null

      // Ensure executable permissions on non-windows
      if (process.platform !== 'win32') {
        try {
          // Use sync version for simplicity during init check
          chmodSync(expectedPath, 0o755)
          console.log(`Ensured execute permissions for ${expectedPath}`)
        } catch (chmodError) {
          console.warn(`Failed to ensure execute permissions for ${expectedPath}:`, chmodError)
          this.status.sevenZip.ready = false // Mark as not ready if permissions fail
          this.status.sevenZip.error = `Permission error: ${chmodError instanceof Error ? chmodError.message : String(chmodError)}`
        }
      }
    } else {
      console.error(`Bundled 7zip NOT found at expected path: ${expectedPath}`)
      this.status.sevenZip.ready = false
      this.status.sevenZip.error = `Bundled 7zip not found at ${expectedPath}. Check app packaging.`
    }
  }

  // --- rclone ---

  public getRclonePath(): string {
    const platform = process.platform
    const exeSuffix = platform === 'win32' ? '.exe' : ''
    // rclone is downloaded to userData/bin
    return join(this.binDir, `rclone${exeSuffix}`)
  }

  private async checkOrDownloadRclone(progressCallback?: ProgressCallback): Promise<void> {
    const expectedPath = this.getRclonePath()
    this.status.rclone.path = expectedPath

    if (existsSync(expectedPath)) {
      console.log(`rclone found at ${expectedPath}`)
      this.status.rclone.ready = true
      this.status.rclone.downloading = false
      this.status.rclone.error = null
      return
    }

    console.log(`rclone not found at ${expectedPath}, attempting download.`)
    this.status.rclone.ready = false
    this.status.rclone.downloading = true
    this.status.rclone.error = null
    progressCallback?.({ name: 'rclone', percentage: 0 })

    let tempArchivePath: string | null = null
    let tempExtractDir: string | null = null

    try {
      const downloadUrl = await this.getRcloneDownloadUrl()
      if (!downloadUrl) {
        throw new Error('Could not find suitable rclone download URL.')
      }

      tempArchivePath = join(app.getPath('temp'), `rclone-download-${Date.now()}.zip`)
      console.log(`Downloading rclone from ${downloadUrl} to ${tempArchivePath}`)

      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        onDownloadProgress: (progressEvent: AxiosProgressEvent) => {
          if (progressEvent.total) {
            const percentage = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            progressCallback?.({ name: 'rclone', percentage })
          }
        }
      })

      const writer = createWriteStream(tempArchivePath)
      response.data.pipe(writer)
      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
        response.data.on('error', reject)
      })

      console.log(`rclone download complete: ${tempArchivePath}`)
      progressCallback?.({ name: 'rclone', percentage: 100 })

      // --- Extraction Step ---
      tempExtractDir = join(app.getPath('temp'), `rclone-extract-${Date.now()}`)
      console.log(`Extracting archive: ${tempArchivePath} to ${tempExtractDir}`)
      progressCallback?.({ name: 'rclone-extract', percentage: 0 })

      // Use the bundled 7zip for extraction if it's ready
      const sevenZipPath = this.status.sevenZip.ready ? this.status.sevenZip.path : null
      if (!sevenZipPath) {
        throw new Error('Bundled 7zip is not available or ready, cannot extract rclone archive.')
      }

      console.log(`Using bundled 7zip at ${sevenZipPath} for extraction.`)
      await execa(sevenZipPath, ['x', tempArchivePath, `-o${tempExtractDir}`, '-y'])
      // await extract(tempArchivePath, { dir: tempExtractDir }) // Old extract-zip method
      console.log(`Archive extracted to ${tempExtractDir}`)

      // Find the binary within the extracted files (usually in a subdirectory)
      const binaryName = process.platform === 'win32' ? 'rclone.exe' : 'rclone'
      let foundBinaryPath: string | null = null

      // Rclone zip extracts into a folder like rclone-vX.Y.Z-os-arch/
      const entries = await fsPromises.readdir(tempExtractDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const potentialPath = join(tempExtractDir, entry.name, binaryName)
          if (existsSync(potentialPath)) {
            foundBinaryPath = potentialPath
            break
          }
        }
        // Check root of extracted dir as well (less common for rclone zip)
        const rootPath = join(tempExtractDir, binaryName)
        if (!foundBinaryPath && existsSync(rootPath)) {
          foundBinaryPath = rootPath
        }
      }

      if (!foundBinaryPath) {
        console.error(`Could not find ${binaryName} within extracted files in ${tempExtractDir}`)
        throw new Error(`Could not locate ${binaryName} after extraction.`)
      }

      console.log(`Found rclone binary at ${foundBinaryPath}. Copying to ${expectedPath}...`)
      await fsPromises.copyFile(foundBinaryPath, expectedPath)
      console.log(`Successfully copied rclone binary to ${expectedPath}`)

      // Clean up temp dirs and archive
      console.log(`Cleaning up temporary files: ${tempExtractDir} and ${tempArchivePath}`)
      await fsPromises.rm(tempExtractDir, { recursive: true, force: true })
      await fsPromises.unlink(tempArchivePath)
      tempArchivePath = null

      this.status.rclone.ready = true
      this.status.rclone.error = null
      progressCallback?.({ name: 'rclone-extract', percentage: 100 })

      // Set executable permissions
      if (process.platform !== 'win32') {
        try {
          await fsPromises.chmod(expectedPath, 0o755)
          console.log(`Set executable permissions for ${expectedPath}`)
        } catch (chmodError) {
          console.warn(`Failed to set executable permissions for ${expectedPath}:`, chmodError)
          // Consider marking rclone as not ready if chmod fails
          this.status.rclone.ready = false
          this.status.rclone.error = `Permission error: ${chmodError instanceof Error ? chmodError.message : String(chmodError)}`
        }
      }
    } catch (error) {
      console.error(
        'Error during rclone download/extraction:',
        error instanceof Error ? error.message : String(error)
      )
      this.status.rclone.ready = false
      this.status.rclone.downloading = false
      this.status.rclone.error = error instanceof Error ? error.message : 'Unknown download error'
      try {
        if (tempArchivePath && existsSync(tempArchivePath)) {
          await fsPromises.unlink(tempArchivePath)
          console.log(`Cleaned up rclone temp archive: ${tempArchivePath}`)
        }
        if (tempExtractDir && existsSync(tempExtractDir)) {
          await fsPromises.rm(tempExtractDir, { recursive: true, force: true })
          console.log(`Cleaned up rclone temp extraction directory: ${tempExtractDir}`)
        }
      } catch (cleanupError) {
        console.error('Failed to cleanup rclone temp files on error:', cleanupError)
      }
    } finally {
      this.status.rclone.downloading = false
    }
  }

  private async getRcloneDownloadUrl(): Promise<string | null> {
    const repo = 'rclone/rclone'
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`
    console.log(`Fetching latest rclone release info from ${apiUrl}`)

    try {
      const response = await axios.get(apiUrl, { timeout: 15000 })
      const release = response.data
      const assets: GitHubAsset[] = release?.assets

      if (!assets || !Array.isArray(assets)) {
        console.error('No rclone assets found in the latest release data.')
        return null
      }

      console.log(`Found ${assets.length} rclone assets for release ${release.tag_name}`)

      const platform = process.platform
      const arch = process.arch
      let platformSuffix = ''
      let archSuffix = ''

      // Determine platform suffix
      if (platform === 'win32') platformSuffix = 'windows'
      else if (platform === 'darwin') platformSuffix = 'osx'
      else if (platform === 'linux') platformSuffix = 'linux'
      else return null // Unsupported platform

      // Determine arch suffix
      if (arch === 'x64') archSuffix = 'amd64'
      else if (arch === 'arm64') archSuffix = 'arm64'
      else if (arch === 'ia32')
        archSuffix = '386' // rclone uses 386 for ia32
      // Add arm? rclone might use 'arm'
      else return null // Unsupported arch

      // Rclone uses .zip for all these combos
      const targetFileNamePattern = `-${platformSuffix}-${archSuffix}.zip`
      console.log(`Searching for rclone asset ending with: ${targetFileNamePattern}`)

      const targetAsset = assets.find((a) => a.name.endsWith(targetFileNamePattern))

      if (!targetAsset?.browser_download_url) {
        console.error(`Could not find a suitable rclone asset for pattern ${targetFileNamePattern}`)
        return null
      }

      console.log(`Selected rclone asset: ${targetAsset.name}`)
      return targetAsset.browser_download_url
    } catch (error) {
      console.error(
        `Error fetching rclone release info from GitHub:`,
        error instanceof Error ? error.message : String(error)
      )
      return null
    }
  }

  // --- Public Methods ---

  getStatus(): DependencyStatus {
    return this.status
  }
}

export default new DependencyService()
