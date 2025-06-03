import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { EventEmitter } from 'events'
import { execa } from 'execa'
import * as ini from 'ini'
import crypto from 'crypto'
import dependencyService from './dependencyService'
import { Mirror, MirrorConfig, MirrorAPI, MirrorTestResult } from '@shared/types'
import { typedWebContentsSend } from '@shared/ipc-utils'

interface MirrorMetadata {
  id: string
  name: string
  configFileName: string
  remoteName: string
  type: string
  host: string
  port?: number
  isActive: boolean
  lastTested?: Date
  testStatus: 'untested' | 'testing' | 'success' | 'failed'
  testError?: string
  addedDate: Date
}

class MirrorService extends EventEmitter implements MirrorAPI {
  private mirrorsDir: string
  private metadataPath: string
  private mirrors: MirrorMetadata[] = []
  private activeMirrorId: string | null = null

  constructor() {
    super()
    this.mirrorsDir = join(app.getPath('userData'), 'mirrors')
    this.metadataPath = join(this.mirrorsDir, 'metadata.json')
  }

  async initialize(): Promise<void> {
    console.log('Initializing MirrorService...')

    // Create mirrors directory if it doesn't exist
    await fs.mkdir(this.mirrorsDir, { recursive: true })

    await this.loadMirrors()
    console.log('MirrorService initialized.')
  }

  private async loadMirrors(): Promise<void> {
    try {
      if (existsSync(this.metadataPath)) {
        const data = await fs.readFile(this.metadataPath, 'utf-8')
        const savedData = JSON.parse(data)
        this.mirrors = savedData.mirrors || []
        this.activeMirrorId = savedData.activeMirrorId || null

        // Convert date strings back to Date objects
        this.mirrors.forEach((mirror) => {
          if (mirror.lastTested) {
            mirror.lastTested = new Date(mirror.lastTested)
          }
          mirror.addedDate = new Date(mirror.addedDate)
        })

        console.log(`Loaded ${this.mirrors.length} mirrors, active: ${this.activeMirrorId}`)
      } else {
        console.log('No mirrors metadata found, starting with empty list')
      }
    } catch (error) {
      console.error('Error loading mirrors:', error)
      this.mirrors = []
      this.activeMirrorId = null
    }
  }

  private async saveMirrors(): Promise<void> {
    try {
      const data = {
        mirrors: this.mirrors,
        activeMirrorId: this.activeMirrorId
      }
      await fs.writeFile(this.metadataPath, JSON.stringify(data, null, 2), 'utf-8')
      console.log('Mirrors metadata saved successfully')
      this.emitMirrorsUpdated()
    } catch (error) {
      console.error('Error saving mirrors metadata:', error)
    }
  }

  private async emitMirrorsUpdated(): Promise<void> {
    // Convert metadata to Mirror objects for the UI
    const mirrorObjects: Mirror[] = []

    for (const metadata of this.mirrors) {
      // We still need to create the config object for the UI, but we don't parse it
      const config: MirrorConfig = {
        id: metadata.id,
        name: metadata.remoteName,
        type: metadata.type,
        host: metadata.host,
        port: metadata.port
      }

      const mirror: Mirror = {
        id: metadata.id,
        name: metadata.name,
        config,
        isActive: metadata.isActive,
        lastTested: metadata.lastTested,
        testStatus: metadata.testStatus,
        testError: metadata.testError,
        addedDate: metadata.addedDate
      }

      mirrorObjects.push(mirror)
    }

    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      typedWebContentsSend.send(mainWindow, 'mirrors:mirrors-updated', mirrorObjects)
    }
  }

  private emitTestProgress(
    id: string,
    status: 'testing' | 'success' | 'failed',
    error?: string
  ): void {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      typedWebContentsSend.send(mainWindow, 'mirrors:test-progress', id, status, error)
    }
  }

  async getMirrors(): Promise<Mirror[]> {
    // Convert metadata to Mirror objects
    const mirrorObjects: Mirror[] = []

    for (const metadata of this.mirrors) {
      const config: MirrorConfig = {
        id: metadata.id,
        name: metadata.remoteName,
        type: metadata.type,
        host: metadata.host,
        port: metadata.port
      }

      const mirror: Mirror = {
        id: metadata.id,
        name: metadata.name,
        config,
        isActive: metadata.isActive,
        lastTested: metadata.lastTested,
        testStatus: metadata.testStatus,
        testError: metadata.testError,
        addedDate: metadata.addedDate
      }

      mirrorObjects.push(mirror)
    }

    return mirrorObjects
  }

  async addMirror(configContent: string): Promise<boolean> {
    try {
      // Parse the INI content to extract basic info
      const parsed = ini.parse(configContent)

      // Find the first section (should be the mirror config)
      const sectionNames = Object.keys(parsed)
      if (sectionNames.length === 0) {
        console.error('No sections found in config file')
        return false
      }

      const remoteName = sectionNames[0]
      const config = parsed[remoteName]

      if (!config.type || !config.host) {
        console.error('Invalid mirror config: missing type or host')
        return false
      }

      // Generate unique ID and filename
      const id = crypto.randomUUID()
      const configFileName = `${id}.conf`
      const configFilePath = join(this.mirrorsDir, configFileName)

      // Save the original config file as-is
      await fs.writeFile(configFilePath, configContent, 'utf-8')

      // Create metadata entry
      const metadata: MirrorMetadata = {
        id,
        name: remoteName, // Use section name as display name
        configFileName,
        remoteName,
        type: config.type,
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : undefined,
        isActive: this.mirrors.length === 0, // First mirror becomes active by default
        lastTested: undefined,
        testStatus: 'untested',
        addedDate: new Date()
      }

      // If this is the first mirror, make it active
      if (this.mirrors.length === 0) {
        this.activeMirrorId = id
      }

      this.mirrors.push(metadata)
      await this.saveMirrors()

      console.log(`Added mirror: ${remoteName} (${id}) -> ${configFileName}`)
      return true
    } catch (error) {
      console.error('Error adding mirror:', error)
      return false
    }
  }

  async removeMirror(id: string): Promise<boolean> {
    const index = this.mirrors.findIndex((m) => m.id === id)
    if (index === -1) {
      console.error(`Mirror not found: ${id}`)
      return false
    }

    const mirror = this.mirrors[index]

    try {
      // Delete the config file
      const configFilePath = join(this.mirrorsDir, mirror.configFileName)
      if (existsSync(configFilePath)) {
        await fs.unlink(configFilePath)
        console.log(`Deleted config file: ${mirror.configFileName}`)
      }
    } catch (error) {
      console.warn(`Failed to delete config file for mirror ${id}:`, error)
      // Continue with removal even if file deletion fails
    }

    // If removing the active mirror, clear active mirror
    if (this.activeMirrorId === id) {
      this.activeMirrorId = null
      // Set the first remaining mirror as active if any exist
      if (this.mirrors.length > 1) {
        const remainingMirrors = this.mirrors.filter((m) => m.id !== id)
        if (remainingMirrors.length > 0) {
          this.activeMirrorId = remainingMirrors[0].id
          remainingMirrors[0].isActive = true
        }
      }
    }

    this.mirrors.splice(index, 1)
    await this.saveMirrors()

    console.log(`Removed mirror: ${mirror.name} (${id})`)
    return true
  }

  async setActiveMirror(id: string): Promise<boolean> {
    const mirror = this.mirrors.find((m) => m.id === id)
    if (!mirror) {
      console.error(`Mirror not found: ${id}`)
      return false
    }

    // Update active status
    this.mirrors.forEach((m) => {
      m.isActive = m.id === id
    })

    this.activeMirrorId = id
    await this.saveMirrors()

    console.log(`Set active mirror: ${mirror.name} (${id})`)
    return true
  }

  async clearActiveMirror(): Promise<boolean> {
    // Update active status - no mirror is active
    this.mirrors.forEach((m) => {
      m.isActive = false
    })

    this.activeMirrorId = null
    await this.saveMirrors()

    console.log('Cleared active mirror - using public endpoint')
    return true
  }

  async testMirror(id: string): Promise<MirrorTestResult> {
    const mirror = this.mirrors.find((m) => m.id === id)
    if (!mirror) {
      throw new Error(`Mirror not found: ${id}`)
    }

    console.log(`Testing mirror: ${mirror.name} (${id})`)

    // Update mirror status to testing
    mirror.testStatus = 'testing'
    await this.saveMirrors()
    this.emitTestProgress(id, 'testing')

    const startTime = Date.now()

    try {
      // Get rclone path
      const rclonePath = dependencyService.getRclonePath()

      // Use the original config file directly
      const configFilePath = join(this.mirrorsDir, mirror.configFileName)

      // Test connectivity using rclone lsd (list directories)
      await execa(
        rclonePath,
        [
          'lsd',
          `${mirror.remoteName}:`,
          '--config',
          configFilePath,
          '--timeout',
          '10s',
          '--retries',
          '1'
        ],
        {
          timeout: 15000, // 15 second timeout
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )

      const responseTime = Date.now() - startTime

      // Update mirror status
      mirror.testStatus = 'success'
      mirror.lastTested = new Date()
      mirror.testError = undefined
      await this.saveMirrors()

      const testResult: MirrorTestResult = {
        id,
        success: true,
        responseTime,
        timestamp: new Date()
      }

      this.emitTestProgress(id, 'success')
      console.log(`Mirror test successful: ${mirror.name} (${responseTime}ms)`)

      return testResult
    } catch (error) {
      const responseTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Update mirror status
      mirror.testStatus = 'failed'
      mirror.lastTested = new Date()
      mirror.testError = errorMessage
      await this.saveMirrors()

      const testResult: MirrorTestResult = {
        id,
        success: false,
        responseTime,
        error: errorMessage,
        timestamp: new Date()
      }

      this.emitTestProgress(id, 'failed', errorMessage)
      console.log(`Mirror test failed: ${mirror.name} - ${errorMessage}`)

      return testResult
    }
  }

  async testAllMirrors(): Promise<MirrorTestResult[]> {
    console.log(`Testing all ${this.mirrors.length} mirrors...`)
    const results: MirrorTestResult[] = []

    // Test mirrors sequentially to avoid overwhelming the system
    for (const mirror of this.mirrors) {
      try {
        const result = await this.testMirror(mirror.id)
        results.push(result)
      } catch (error) {
        console.error(`Error testing mirror ${mirror.name}:`, error)
        results.push({
          id: mirror.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        })
      }
    }

    console.log(
      `Completed testing all mirrors. ${results.filter((r) => r.success).length}/${results.length} successful`
    )
    return results
  }

  async getActiveMirror(): Promise<Mirror | null> {
    if (!this.activeMirrorId) {
      return null
    }

    const metadata = this.mirrors.find((m) => m.id === this.activeMirrorId)
    if (!metadata) {
      return null
    }

    // Convert to Mirror object
    const config: MirrorConfig = {
      id: metadata.id,
      name: metadata.remoteName,
      type: metadata.type,
      host: metadata.host,
      port: metadata.port
    }

    return {
      id: metadata.id,
      name: metadata.name,
      config,
      isActive: metadata.isActive,
      lastTested: metadata.lastTested,
      testStatus: metadata.testStatus,
      testError: metadata.testError,
      addedDate: metadata.addedDate
    }
  }

  // Method to get the config file path for the active mirror (used by other services)
  getActiveMirrorConfigPath(): string | null {
    const activeMirror = this.mirrors.find((m) => m.id === this.activeMirrorId)
    if (!activeMirror) {
      return null
    }
    return join(this.mirrorsDir, activeMirror.configFileName)
  }

  // Method to get the active mirror's remote name for rclone commands
  getActiveMirrorRemoteName(): string | null {
    const activeMirror = this.mirrors.find((m) => m.id === this.activeMirrorId)
    return activeMirror ? activeMirror.remoteName : null
  }

  // Legacy method for backward compatibility (now just returns config file path)
  getActiveMirrorRcloneConfig(): string | null {
    return this.getActiveMirrorConfigPath()
  }
}

export default new MirrorService()
