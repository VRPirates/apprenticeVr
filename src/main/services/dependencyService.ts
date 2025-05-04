import { app } from 'electron'
import { join } from 'path'
import { promises as fsPromises, existsSync, createWriteStream } from 'fs'
import axios, { AxiosProgressEvent } from 'axios'
import { execa } from 'execa'

// Type definitions
type ProgressCallback = (progress: { name: string; percentage: number }) => void

interface DependencyStatus {
  sevenZip: {
    ready: boolean
    path: string | null
    error: string | null
    downloading: boolean
  }
  // Add rclone status here later
}

// Simple interface for GitHub Release Asset
interface GitHubAsset {
  name: string
  browser_download_url: string
}

class DependencyService {
  private targetDir: string
  private status: DependencyStatus
  private isInitializing: boolean
  private isInitialized: boolean

  constructor() {
    // Binaries will be stored in a 'bin' directory within userData
    this.targetDir = join(app.getPath('userData'), 'bin')
    this.status = {
      sevenZip: { ready: false, path: null, error: null, downloading: false }
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
    await fsPromises.mkdir(this.targetDir, { recursive: true })
    await this.checkOrDownload7zip(progressCallback)
    console.log('DependencyService initialization finished.')
    this.isInitializing = false
    this.isInitialized = true
  }

  // --- 7zip ---

  private get7zPath(): string {
    const platform = process.platform
    const exeSuffix = platform === 'win32' ? '.exe' : ''
    // Store the executable directly in the targetDir
    return join(this.targetDir, `7z${exeSuffix}`)
  }

  private async checkOrDownload7zip(progressCallback?: ProgressCallback): Promise<void> {
    const expectedPath = this.get7zPath()
    this.status.sevenZip.path = expectedPath

    if (existsSync(expectedPath)) {
      console.log(`7zip found at ${expectedPath}`)
      this.status.sevenZip.ready = true
      this.status.sevenZip.downloading = false
      this.status.sevenZip.error = null
      return
    }

    console.log(`7zip not found at ${expectedPath}, attempting download.`)
    this.status.sevenZip.ready = false
    this.status.sevenZip.downloading = true
    this.status.sevenZip.error = null
    progressCallback?.({ name: '7z', percentage: 0 })

    let tempArchivePath: string | null = null
    let tempExtractDir: string | null = null
    let isArchive = false
    const platform = process.platform

    try {
      const { url: downloadUrl, isArchive: archiveFlag } = await this.get7zDownloadUrl()
      isArchive = archiveFlag

      if (!downloadUrl) {
        throw new Error('Could not find suitable 7zip download URL.')
      }

      // Determine target path for download
      const downloadTargetPath =
        platform === 'win32' && !isArchive
          ? expectedPath // Download exe directly to final path
          : join(
              app.getPath('temp'),
              `7zip-download-${Date.now()}${isArchive ? '.archive' : '.exe'}`
            )
      tempArchivePath = platform === 'win32' && !isArchive ? null : downloadTargetPath // Only set temp path if it's an archive

      console.log(`Downloading 7zip from ${downloadUrl} to ${downloadTargetPath}`)

      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        onDownloadProgress: (progressEvent: AxiosProgressEvent) => {
          if (progressEvent.total) {
            const percentage = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            progressCallback?.({ name: '7z', percentage })
          }
        }
      })

      const writer = createWriteStream(downloadTargetPath)
      response.data.pipe(writer)

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
        response.data.on('error', reject)
      })

      console.log(`7zip download complete: ${downloadTargetPath}`)
      progressCallback?.({ name: '7z', percentage: 100 })

      // --- Extraction Step ---
      if (isArchive) {
        tempExtractDir = join(app.getPath('temp'), `7zip-extract-${Date.now()}`)
        console.log(`Extracting archive: ${downloadTargetPath} to ${tempExtractDir}`)
        progressCallback?.({ name: '7z-extract', percentage: 0 })

        await fsPromises.mkdir(tempExtractDir, { recursive: true })

        try {
          // Extract the whole archive to the temp extract dir
          await execa('tar', ['xf', downloadTargetPath, '-C', tempExtractDir], { stdio: 'inherit' })
          console.log(`Archive extracted to ${tempExtractDir}`)
        } catch (extractError) {
          console.error('tar extraction failed:', extractError)
          throw new Error(
            `Failed to extract archive: ${extractError instanceof Error ? extractError.message : String(extractError)}`
          )
        }

        // Find the binary within the extracted files
        const binaryNameInArchive =
          platform === 'linux' ? '7zzs' : platform === 'darwin' ? '7zz' : '7z'
        let foundBinaryPath: string | null = null

        // Simple search: Check common locations (root and first level dir)
        const rootPath = join(tempExtractDir, binaryNameInArchive)
        if (existsSync(rootPath)) {
          foundBinaryPath = rootPath
        } else {
          // Check first level directories
          const entries = await fsPromises.readdir(tempExtractDir, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const potentialPath = join(tempExtractDir, entry.name, binaryNameInArchive)
              if (existsSync(potentialPath)) {
                foundBinaryPath = potentialPath
                break
              }
            }
          }
        }

        if (!foundBinaryPath) {
          console.error(
            `Could not find ${binaryNameInArchive} within extracted files in ${tempExtractDir}`
          )
          throw new Error(`Could not locate ${binaryNameInArchive} after extraction.`)
        }

        console.log(`Found binary at ${foundBinaryPath}. Copying to ${expectedPath}...`)
        await fsPromises.copyFile(foundBinaryPath, expectedPath)
        console.log(`Successfully copied binary to ${expectedPath}`)

        // Clean up temporary extraction directory and archive
        console.log(`Cleaning up temporary files: ${tempExtractDir} and ${downloadTargetPath}`)
        await fsPromises.rm(tempExtractDir, { recursive: true, force: true })
        await fsPromises.unlink(downloadTargetPath)
        tempArchivePath = null // Archive handled

        this.status.sevenZip.ready = true
        this.status.sevenZip.error = null
        progressCallback?.({ name: '7z-extract', percentage: 100 })
      } else {
        // If it wasn't an archive (Windows .exe), it's already in place
        this.status.sevenZip.ready = true
        this.status.sevenZip.error = null
        // Ensure executable permissions (especially on non-Windows)
        if (platform !== 'win32') {
          try {
            await fsPromises.chmod(expectedPath, 0o755)
            console.log(`Set executable permissions for ${expectedPath}`)
          } catch (chmodError) {
            console.warn(`Failed to set executable permissions for ${expectedPath}:`, chmodError)
            // Decide if this is a fatal error or just a warning
          }
        }
      }
    } catch (error) {
      console.error(
        'Error during 7zip download/extraction:',
        error instanceof Error ? error.message : String(error)
      )
      this.status.sevenZip.ready = false
      this.status.sevenZip.downloading = false
      this.status.sevenZip.error = error instanceof Error ? error.message : 'Unknown download error'
      try {
        if (tempArchivePath && existsSync(tempArchivePath)) {
          await fsPromises.unlink(tempArchivePath)
          console.log(`Cleaned up temp archive: ${tempArchivePath}`)
        }
        if (isArchive && tempExtractDir && existsSync(tempExtractDir)) {
          await fsPromises.rm(tempExtractDir, { recursive: true, force: true })
          console.log(`Cleaned up temp extraction directory: ${tempExtractDir}`)
        }
      } catch (cleanupError) {
        console.error('Failed to cleanup temp files on error:', cleanupError)
      }
    } finally {
      this.status.sevenZip.downloading = false
    }
  }

  private async get7zDownloadUrl(): Promise<{ url: string | null; isArchive: boolean }> {
    const repo = 'ip7z/7zip'
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`
    console.log(`Fetching latest release info from ${apiUrl}`)

    try {
      const response = await axios.get(apiUrl, { timeout: 15000 })
      const release = response.data
      const assets: GitHubAsset[] = release?.assets

      if (!assets || !Array.isArray(assets)) {
        console.error('No assets found in the latest release data.')
        return { url: null, isArchive: false }
      }

      console.log(`Found ${assets.length} assets for release ${release.tag_name}`)

      const platform = process.platform
      const arch = process.arch
      let targetAssetName: string | null = null
      let isArchive = false // Default to not needing extraction

      if (platform === 'win32') {
        if (arch === 'x64')
          targetAssetName = assets.find((a) => /^7z\d+-x64\.exe$/.test(a.name))?.name ?? null
        else if (arch === 'ia32')
          targetAssetName = assets.find((a) => /^7z\d+\.exe$/.test(a.name))?.name ?? null
        // ARM64 Windows? assets.find(a => /^7z\d+-arm64\.exe$/.test(a.name))?.name
        isArchive = false // Windows uses direct executable
      } else if (platform === 'linux') {
        if (arch === 'x64')
          targetAssetName = assets.find((a) => a.name.endsWith('-linux-x64.tar.xz'))?.name ?? null
        else if (arch === 'arm64')
          targetAssetName = assets.find((a) => a.name.endsWith('-linux-arm64.tar.xz'))?.name ?? null
        else if (arch === 'ia32')
          targetAssetName = assets.find((a) => a.name.endsWith('-linux-x86.tar.xz'))?.name ?? null
        isArchive = true // Linux needs extraction
      } else if (platform === 'darwin') {
        targetAssetName = assets.find((a) => a.name.endsWith('-mac.tar.xz'))?.name ?? null
        isArchive = true // macOS needs extraction
      }

      if (!targetAssetName) {
        console.error(`Could not find a suitable 7zip asset for platform=${platform}, arch=${arch}`)
        return { url: null, isArchive: false }
      }

      const targetAsset = assets.find((a) => a.name === targetAssetName)
      if (!targetAsset?.browser_download_url) {
        console.error(`Found asset name ${targetAssetName}, but no download URL.`)
        return { url: null, isArchive: false }
      }

      console.log(`Selected 7zip asset: ${targetAssetName}, Needs extraction: ${isArchive}`)
      return { url: targetAsset.browser_download_url, isArchive }
    } catch (error) {
      console.error(
        `Error fetching 7zip release info from GitHub:`,
        error instanceof Error ? error.message : String(error)
      )
      return { url: null, isArchive: false }
    }
  }

  // --- Public Methods ---

  getStatus(): DependencyStatus {
    return this.status
  }

  // Add checkOrDownloadRclone later
}

export default new DependencyService()
