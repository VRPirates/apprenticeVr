import { join } from 'path'
import { promises as fs, readFileSync } from 'fs'
import axios from 'axios'
import { execa } from 'execa'
import { app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import dependencyService from './dependencyService'
import { GameInfo, ServiceStatus, GamesAPI, OutdatedGame, MissingGame } from '@shared/types'
import EventEmitter from 'events'

interface VrpConfig {
  baseUri: string
  password: string
  lastSync?: Date
}

interface UncrackableGame {
  packagename: string
  gamename: string
  appid: string
  uncrackable: boolean
}

class GameService extends EventEmitter implements GamesAPI {
  private dataPath: string
  private configPath: string
  private gameListPath: string
  private metaPath: string
  private uncrackableGamesPath: string
  private outdatedGamesPath: string
  private missingGamesPath: string
  private vrpConfig: VrpConfig | null = null
  private games: GameInfo[] = []
  private uncrackableGames: UncrackableGame[] = []
  private outdatedGames: OutdatedGame[] = []
  private missingGames: MissingGame[] = []
  private status: ServiceStatus = 'NOT_INITIALIZED'
  constructor() {
    super()
    this.dataPath = join(app.getPath('userData'), 'vrp-data')
    this.configPath = join(this.dataPath, 'vrp-config.json')
    this.gameListPath = join(this.dataPath, 'VRP-GameList.txt')
    this.metaPath = join(this.dataPath, '.meta')
    this.uncrackableGamesPath = join(this.dataPath, 'uncrackable-games.json')
    this.outdatedGamesPath = join(this.dataPath, 'outdated-games.json')
    this.missingGamesPath = join(this.dataPath, 'missing-games.json')
  }

  async initialize(force?: boolean): Promise<ServiceStatus> {
    if (this.status === 'INITIALIZING') {
      console.log('GameService already initializing, skipping.')
      return 'INITIALIZING'
    }
    if (!force && this.status === 'INITIALIZED') {
      console.log('GameService already initialized, skipping.')
      return 'INITIALIZED'
    }
    this.status = 'INITIALIZING'
    console.log('Initializing GameService...')
    await fs.mkdir(this.dataPath, { recursive: true })
    try {
      // Load configuration if exists
      await this.loadConfig()

      // Check if we need to sync data
      // const needsSync = await this.needsSync()

      // if (needsSync) {
      //   console.log('Syncing game data...')
      //   await this.syncGameData()
      // } else {
      console.log('Using cached game data...')
      await this.loadGameList()
      await this.loadUncrackableGames()
      await this.loadOutdatedGames()
      await this.loadMissingGames()
      //}
    } catch (error) {
      console.error('Error initializing game service:', error)
      this.status = 'ERROR'
      return 'ERROR'
    } finally {
      this.status = 'INITIALIZED'
    }
    return 'INITIALIZED'
  }

  private async loadConfig(): Promise<void> {
    try {
      const exists = await fileExists(this.configPath)
      if (exists) {
        const data = await fs.readFile(this.configPath, 'utf-8')
        this.vrpConfig = JSON.parse(data)

        // Convert lastSync string to Date object if it exists
        if (this.vrpConfig?.lastSync) {
          this.vrpConfig.lastSync = new Date(this.vrpConfig.lastSync)
        }

        console.log(
          'Loaded config from disk - baseUri:',
          !!this.vrpConfig?.baseUri,
          'password:',
          !!this.vrpConfig?.password
        )
      } else {
        console.log('No config file found at', this.configPath)
      }
    } catch (error) {
      console.error('Error loading configuration:', error)
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      if (this.vrpConfig) {
        console.log(
          'Saving config to disk - baseUri:',
          !!this.vrpConfig.baseUri,
          'password:',
          !!this.vrpConfig.password
        )
        await fs.writeFile(this.configPath, JSON.stringify(this.vrpConfig), 'utf-8')
      }
    } catch (error) {
      console.error('Error saving configuration:', error)
    }
  }

  // private async needsSync(): Promise<boolean> {
  //   try {
  //     // Check if game list file exists
  //     const gameListExists = await fileExists(this.gameListPath)
  //     if (!gameListExists) {
  //       return true
  //     }

  //     // If no last sync time or it's been more than 24 hours, sync again
  //     if (!this.vrpConfig?.lastSync) {
  //       return true
  //     }

  //     const lastSync = this.vrpConfig.lastSync
  //     const ONE_DAY = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
  //     return Date.now() - lastSync.getTime() > ONE_DAY
  //   } catch (error) {
  //     console.error('Error checking if sync is needed:', error)
  //     return true // Default to sync on error
  //   }
  // }

  async syncGameData(): Promise<void> {
    try {
      // Fetch and parse additional game data
      await Promise.all([
        this.fetchUncrackableGames(),
        this.fetchOutdatedGames(),
        this.fetchMissingGames()
      ])

      // Cache the data to filesystem
      await Promise.all([
        this.saveUncrackableGames(),
        this.saveOutdatedGames(),
        this.saveMissingGames()
      ])

      // First fetch the VRP public info
      await this.fetchVrpPublicInfo()

      if (!this.vrpConfig?.baseUri) {
        throw new Error('Failed to get baseUri from VRP public info')
      }

      if (!this.vrpConfig?.password) {
        throw new Error('Failed to get password from VRP public info')
      }

      console.log(
        'Starting sync with valid config - baseUri:',
        !!this.vrpConfig.baseUri,
        'password:',
        !!this.vrpConfig.password
      )

      // Download meta.7z using rclone
      const metaArchive = join(this.dataPath, 'meta.7z')
      await this.downloadMetaArchive(metaArchive)

      // Extract the archive
      await this.extractMetaArchive(metaArchive)

      // Load the game list
      await this.loadGameList()

      // Update last sync time
      if (this.vrpConfig) {
        this.vrpConfig.lastSync = new Date()
        await this.saveConfig()
      }
    } catch (error) {
      console.error('Error syncing game data:', error)
      throw error
    }
  }

  private async fetchVrpPublicInfo(): Promise<void> {
    try {
      const response = await axios.get('https://vrpirates.wiki/downloads/vrp-public.json', {
        timeout: 10000
      })
      this.vrpConfig = response.data as VrpConfig

      console.log('VRP Config loaded - baseUri:', !!this.vrpConfig?.baseUri)

      await this.saveConfig()
    } catch (error) {
      console.error('Error fetching VRP public info:', error)
      throw error
    }
  }

  private async downloadMetaArchive(destination: string): Promise<void> {
    try {
      if (!this.vrpConfig?.baseUri) {
        throw new Error('baseUri not found in config')
      }

      const baseUri = this.vrpConfig.baseUri

      console.log(`Downloading meta.7z from ${baseUri}...`)

      // Get the appropriate rclone path based on platform
      const rclonePath = dependencyService.getRclonePath()

      // Get the main window to send progress updates
      const mainWindow = BrowserWindow.getAllWindows()[0]

      // Execute rclone using execa with progress reporting
      const rcloneProcess = execa(
        rclonePath,
        [
          'sync',
          `:http:/meta.7z`,
          destination,
          '--http-url',
          baseUri,
          '--tpslimit',
          '1.0',
          '--tpslimit-burst',
          '3',
          '--no-check-certificate',
          '--progress'
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )

      // Process stdout for progress information
      if (rcloneProcess.stdout) {
        rcloneProcess.stdout.on('data', (data) => {
          const output = data.toString()
          console.log('Rclone output:', output)

          // Try to parse progress information from rclone output
          // Example pattern: "Transferred: 5.584M / 10.000 MBytes, 56%, 1.000 MBytes/s, ETA 0s"
          const progressPattern = /Transferred:.*?(\d+)%/
          const match = output.match(progressPattern)

          if (match && match[1]) {
            const progressPercentage = parseInt(match[1], 10)

            // Send progress to renderer process if we have a valid window
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('games:download-progress', {
                type: 'meta',
                progress: progressPercentage
              })
            }
          }
        })
      }

      // Process stderr for errors
      if (rcloneProcess.stderr) {
        rcloneProcess.stderr.on('data', (data) => {
          console.error('Rclone error:', data.toString())
        })
      }

      // Wait for process to complete
      const result = await rcloneProcess

      if (result.exitCode !== 0) {
        throw new Error(`Rclone failed with exit code ${result.exitCode}: ${result.stderr}`)
      }

      console.log('Download complete')

      // Send 100% progress on completion
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('games:download-progress', {
          type: 'meta',
          progress: 100
        })
      }
    } catch (error) {
      console.error('Error downloading meta archive:', error)
      throw error
    }
  }

  private async extractMetaArchive(archive: string): Promise<void> {
    try {
      console.log(`Extracting ${archive} to ${this.dataPath}...`)

      if (!this.vrpConfig?.password) {
        throw new Error('Password not found in vrpConfig')
      }

      try {
        // Base64 decode the password
        const decodedPassword = Buffer.from(this.vrpConfig.password, 'base64').toString('utf-8')
        console.log('Successfully decoded password for extraction')

        // Get the appropriate 7z path based on platform
        const sevenZipPath = dependencyService.get7zPath()

        // Get the main window to send progress updates
        const mainWindow = BrowserWindow.getAllWindows()[0]

        // Execute 7z using execa with progress reporting
        const sevenZipProcess = execa(
          sevenZipPath,
          [
            'x', // extract with full paths
            archive, // archive to extract
            `-o${this.dataPath}`, // output directory
            `-p${decodedPassword}`, // password for extraction
            '-y' // yes to all prompts
          ],
          {
            stdio: ['ignore', 'pipe', 'pipe']
          }
        )

        let totalFiles = 0
        let extractedFiles = 0
        let wrongPassword = false

        // Process stdout for progress information
        if (sevenZipProcess.stdout) {
          sevenZipProcess.stdout.on('data', (data) => {
            const output = data.toString()
            console.log('7z output:', output)

            // Check for wrong password
            if (output.includes('Wrong password')) {
              wrongPassword = true
            }

            // Try to get total files count
            const totalMatch = output.match(/(\d+) files?/i)
            if (totalMatch && totalMatch[1] && totalFiles === 0) {
              totalFiles = parseInt(totalMatch[1], 10)
            }

            // Track extracting progress
            if (output.includes('Extracting')) {
              extractedFiles++
              if (totalFiles > 0) {
                const progressPercentage = Math.min(
                  Math.round((extractedFiles / totalFiles) * 100),
                  99
                )

                // Send progress to renderer process if we have a valid window
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('games:extract-progress', {
                    type: 'meta',
                    progress: progressPercentage
                  })
                }
              }
            }
          })
        }

        // Process stderr for errors
        if (sevenZipProcess.stderr) {
          sevenZipProcess.stderr.on('data', (data) => {
            const error = data.toString()
            console.error('7z error:', error)

            // Check for wrong password in stderr as well
            if (error.includes('Wrong password')) {
              wrongPassword = true
            }
          })
        }

        // Wait for process to complete
        const result = await sevenZipProcess

        if (result.exitCode !== 0) {
          if (wrongPassword) {
            throw new Error('Extraction failed: Wrong password for archive')
          }
          throw new Error(`7z failed with exit code ${result.exitCode}: ${result.stderr}`)
        }

        console.log('Extraction complete')

        // Send 100% progress on completion
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('games:extract-progress', {
            type: 'meta',
            progress: 100
          })
        }
      } catch (decodeError: unknown) {
        console.error('Error decoding or using password:', decodeError)
        if (decodeError instanceof Error) {
          throw new Error(`Failed to use password: ${decodeError.message}`)
        } else {
          throw new Error(`Failed to use password: ${String(decodeError)}`)
        }
      }
    } catch (error) {
      console.error('Error extracting meta archive:', error)
      throw error
    }
  }

  private async loadGameList(): Promise<void> {
    try {
      const exists = await fileExists(this.gameListPath)
      if (!exists) {
        console.error('Game list file not found')
        return
      }

      const data = await fs.readFile(this.gameListPath, 'utf-8')
      this.parseGameList(data)
    } catch (error) {
      console.error('Error loading game list:', error)
    }
  }

  private parseGameList(data: string): void {
    const lines = data.split('\n')
    const games: GameInfo[] = []

    // Skip the header line
    const headerLine = lines[0]
    if (!headerLine || !headerLine.includes(';')) {
      console.error('Invalid header format in game list')
      return
    }
    console.log('Header Line:', headerLine)

    // Extract column names from header
    const columns = headerLine.split(';').map((col) => col.trim())
    console.log('Parsed Columns:', columns)

    const gameNameIndex = columns.indexOf('Game Name')
    const packageNameIndex = columns.indexOf('Package Name')
    const versionCodeIndex = columns.indexOf('Version Code')
    const sizeIndex = columns.indexOf('Size (MB)')
    const lastUpdatedIndex = columns.indexOf('Last Updated')
    const releaseNameIndex = columns.indexOf('Release Name')
    const downloadsIndex = columns.indexOf('Downloads')

    // Process data lines (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      try {
        const parts = line.split(';')

        // Skip if we don't have all columns
        if (parts.length < columns.length) {
          console.warn(
            `Skipping incomplete game entry (expected ${columns.length}, got ${parts.length}): ${line}`
          )
          continue
        }

        // Get values from the correct column positions
        const gameName = gameNameIndex >= 0 ? parts[gameNameIndex].trim() : 'Unknown'
        const packageName = packageNameIndex >= 0 ? parts[packageNameIndex].trim() : ''
        const versionCode = versionCodeIndex >= 0 ? parts[versionCodeIndex].trim() : ''
        const size = sizeIndex >= 0 ? `${parts[sizeIndex].trim()} MB` : ''
        const lastUpdated = lastUpdatedIndex >= 0 ? parts[lastUpdatedIndex].trim() : ''
        const releaseName = releaseNameIndex >= 0 ? parts[releaseNameIndex].trim() : ''
        const downloads = downloadsIndex >= 0 ? parts[downloadsIndex].trim() : ''

        if (gameName === 'Unknown') {
          console.warn(
            `Game name is Unknown for line: ${line}. gameNameIndex: ${gameNameIndex}, parts[gameNameIndex]: ${parts[gameNameIndex]}`
          )
        }

        // Skip if we don't have essential information
        if (!gameName || !packageName) {
          console.warn(`Skipping game with missing name or package: ${line}`)
          continue
        }

        // Generate thumbnail path if the package name is available
        const thumbnailPath = packageName
          ? join(this.metaPath, 'thumbnails', `${packageName}.jpg`)
          : ''

        const thumbnailExists = existsSync(thumbnailPath)

        // Generate note path based on release name
        const notePath = releaseName ? join(this.metaPath, 'notes', `${releaseName}.txt`) : ''

        const gameInfo: GameInfo = {
          id: packageName || gameName.replace(/\s+/g, '-').toLowerCase(),
          name: gameName,
          packageName,
          version: versionCode,
          size,
          lastUpdated,
          releaseName,
          downloads: parseFloat(downloads) || 0,
          thumbnailPath: thumbnailExists ? thumbnailPath : '',
          notePath,
          isInstalled: false
        }

        games.push(gameInfo)
      } catch (error) {
        console.error('Error parsing game line:', line, error)
      }
    }

    this.games = games
    console.log(`Loaded ${games.length} games`)
  }

  async forceSync(): Promise<GameInfo[]> {
    await this.syncGameData()
    return this.games
  }

  getGames(): Promise<GameInfo[]> {
    return Promise.resolve(this.games)
  }

  getLastSyncTime(): Promise<Date | null> {
    return Promise.resolve(this.vrpConfig?.lastSync || null)
  }

  // Added method to expose VRP config needed by DownloadService
  getVrpConfig(): Promise<{ baseUri?: string; password?: string } | null> {
    if (!this.vrpConfig) {
      console.warn('Attempted to get VRP config before it was loaded.')
      return Promise.resolve(null)
    }
    // Return only necessary parts, don't expose lastSync etc.
    return Promise.resolve({
      baseUri: this.vrpConfig.baseUri,
      password: this.vrpConfig.password
    })
  }

  getNote(releaseName: string): Promise<string> {
    const notePath = join(this.metaPath, 'notes', `${releaseName}.txt`)
    const noteExists = existsSync(notePath)
    return Promise.resolve(noteExists ? readFileSync(notePath, 'utf-8') : '')
  }

  // New methods to fetch and parse additional game data
  private async fetchUncrackableGames(): Promise<void> {
    try {
      console.log('Fetching uncrackable games list...')
      const response = await axios.get('https://uncrackable.vrpirates.wiki/uncrackable.json', {
        timeout: 10000
      })
      this.uncrackableGames = response.data as UncrackableGame[]
      console.log(`Loaded ${this.uncrackableGames.length} uncrackable games`)
    } catch (error) {
      console.error('Error fetching uncrackable games:', error)
    }
  }

  private async saveUncrackableGames(): Promise<void> {
    try {
      console.log(`Saving ${this.uncrackableGames.length} uncrackable games to disk`)
      await fs.writeFile(this.uncrackableGamesPath, JSON.stringify(this.uncrackableGames), 'utf-8')
    } catch (error) {
      console.error('Error saving uncrackable games:', error)
    }
  }

  private async loadUncrackableGames(): Promise<void> {
    try {
      const exists = await fileExists(this.uncrackableGamesPath)
      if (!exists) {
        console.log('No cached uncrackable games found')
        return
      }

      const data = await fs.readFile(this.uncrackableGamesPath, 'utf-8')
      this.uncrackableGames = JSON.parse(data) as UncrackableGame[]
      console.log(`Loaded ${this.uncrackableGames.length} uncrackable games from cache`)
    } catch (error) {
      console.error('Error loading uncrackable games from cache:', error)
    }
  }

  private async fetchOutdatedGames(): Promise<void> {
    try {
      console.log('Fetching outdated games list...')
      const response = await axios.get(
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vQW_5jn_Iy3Ykab5BO5gtqP4CVxu6YGsovZlwQIOc2AzdfncpSXMwfqo4rK71xtHAUAYOz65pQtOToH/pub?gid=1758218295&single=true&output=csv',
        {
          timeout: 10000
        }
      )
      this.outdatedGames = this.parseCSV<OutdatedGame>(response.data)
      console.log(`Loaded ${this.outdatedGames.length} outdated games`)
    } catch (error) {
      console.error('Error fetching outdated games:', error)
    }
  }

  private async saveOutdatedGames(): Promise<void> {
    try {
      console.log(`Saving ${this.outdatedGames.length} outdated games to disk`)
      await fs.writeFile(this.outdatedGamesPath, JSON.stringify(this.outdatedGames), 'utf-8')
    } catch (error) {
      console.error('Error saving outdated games:', error)
    }
  }

  private async loadOutdatedGames(): Promise<void> {
    try {
      const exists = await fileExists(this.outdatedGamesPath)
      if (!exists) {
        console.log('No cached outdated games found')
        return
      }

      const data = await fs.readFile(this.outdatedGamesPath, 'utf-8')
      this.outdatedGames = JSON.parse(data) as OutdatedGame[]

      console.log(`Loaded ${this.outdatedGames.length} outdated games from cache`)
    } catch (error) {
      console.error('Error loading outdated games from cache:', error)
    }
  }

  private async fetchMissingGames(): Promise<void> {
    try {
      console.log('Fetching missing games list...')
      const response = await axios.get(
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vQW_5jn_Iy3Ykab5BO5gtqP4CVxu6YGsovZlwQIOc2AzdfncpSXMwfqo4rK71xtHAUAYOz65pQtOToH/pub?gid=1216563963&single=true&output=csv',
        {
          timeout: 10000
        }
      )
      this.missingGames = this.parseCSV<MissingGame>(response.data)
      console.log(`Loaded ${this.missingGames.length} missing games`)
    } catch (error) {
      console.error('Error fetching missing games:', error)
    }
  }

  private async saveMissingGames(): Promise<void> {
    try {
      console.log(`Saving ${this.missingGames.length} missing games to disk`)
      await fs.writeFile(this.missingGamesPath, JSON.stringify(this.missingGames), 'utf-8')
    } catch (error) {
      console.error('Error saving missing games:', error)
    }
  }

  private async loadMissingGames(): Promise<void> {
    try {
      const exists = await fileExists(this.missingGamesPath)
      if (!exists) {
        console.log('No cached missing games found')
        return
      }

      const data = await fs.readFile(this.missingGamesPath, 'utf-8')
      this.missingGames = JSON.parse(data) as MissingGame[]
      console.log(`Loaded ${this.missingGames.length} missing games from cache`)
    } catch (error) {
      console.error('Error loading missing games from cache:', error)
    }
  }

  private parseCSV<T>(csvData: string): T[] {
    const lines = csvData.split('\n')
    const result: T[] = []

    // Skip if empty
    if (lines.length <= 1) return result

    // Extract header
    const header = lines[0].split(',').map((h) => h.trim())

    // Process data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const values = line.split(',')
      if (values.length < header.length) continue

      const obj = {} as Record<string, string>
      header.forEach((key, index) => {
        // Convert header to camelCase for consistency
        const camelKey = key.charAt(0).toLowerCase() + key.slice(1)
        obj[camelKey] = values[index]?.trim() || ''
      })

      result.push(obj as unknown as T)
    }

    return result
  }

  // Additional public methods to access data
  getUncrackableGames(): Promise<UncrackableGame[]> {
    return Promise.resolve(this.uncrackableGames)
  }

  getOutdatedGames(): Promise<OutdatedGame[]> {
    return Promise.resolve(this.outdatedGames)
  }

  getMissingGames(): Promise<MissingGame[]> {
    return Promise.resolve(this.missingGames)
  }

  // Check if a specific game is uncrackable
  isGameUncrackable(packageName: string): Promise<boolean> {
    const game = this.uncrackableGames.find((g) => g.packagename === packageName)
    return Promise.resolve(!!game && game.uncrackable)
  }

  // Check if a specific game is outdated
  isGameOutdated(packageName: string): Promise<boolean> {
    return Promise.resolve(!!this.outdatedGames.find((g) => g.packageName === packageName))
  }

  // Check if a specific game is in the missing list
  isGameMissing(packageName: string): Promise<boolean> {
    return Promise.resolve(!!this.missingGames.find((g) => g.packageName === packageName))
  }
}

// Helper function to check if a file exists
async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export default new GameService()
