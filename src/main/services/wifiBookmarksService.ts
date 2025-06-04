import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import { WiFiBookmark } from '@shared/types'
import { randomUUID } from 'crypto'

class WiFiBookmarksService {
  private bookmarksFilePath: string
  private bookmarks: WiFiBookmark[] = []

  constructor() {
    const userDataPath = app.getPath('userData')
    this.bookmarksFilePath = path.join(userDataPath, 'wifi-bookmarks.json')
  }

  async initialize(): Promise<void> {
    try {
      await this.loadBookmarks()
      console.log('[WiFi Bookmarks] Service initialized')
    } catch (error) {
      console.error('[WiFi Bookmarks] Error initializing service:', error)
    }
  }

  private async loadBookmarks(): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.bookmarksFilePath, 'utf-8')
      const data: unknown[] = JSON.parse(fileContent)
      this.bookmarks = data.map((bookmark: unknown) => {
        const b = bookmark as Record<string, unknown>
        return {
          id: b.id as string,
          name: b.name as string,
          ipAddress: b.ipAddress as string,
          port: b.port as number,
          dateAdded: new Date(b.dateAdded as string),
          lastConnected: b.lastConnected ? new Date(b.lastConnected as string) : undefined
        }
      })
      console.log(`[WiFi Bookmarks] Loaded ${this.bookmarks.length} bookmarks`)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        console.log('[WiFi Bookmarks] No existing bookmarks file, starting fresh')
        this.bookmarks = []
      } else {
        console.error('[WiFi Bookmarks] Error loading bookmarks:', error)
        this.bookmarks = []
      }
    }
  }

  private async saveBookmarks(): Promise<void> {
    try {
      await fs.writeFile(this.bookmarksFilePath, JSON.stringify(this.bookmarks, null, 2))
      console.log('[WiFi Bookmarks] Bookmarks saved successfully')
    } catch (error) {
      console.error('[WiFi Bookmarks] Error saving bookmarks:', error)
      throw error
    }
  }

  async getAllBookmarks(): Promise<WiFiBookmark[]> {
    return [...this.bookmarks]
  }

  async addBookmark(name: string, ipAddress: string, port: number): Promise<boolean> {
    try {
      // Check if bookmark already exists
      const existingBookmark = this.bookmarks.find(
        (bookmark) => bookmark.ipAddress === ipAddress && bookmark.port === port
      )

      if (existingBookmark) {
        console.log(`[WiFi Bookmarks] Bookmark for ${ipAddress}:${port} already exists`)
        return false
      }

      const newBookmark: WiFiBookmark = {
        id: randomUUID(),
        name,
        ipAddress,
        port,
        dateAdded: new Date()
      }

      this.bookmarks.push(newBookmark)
      await this.saveBookmarks()
      console.log(`[WiFi Bookmarks] Added bookmark: ${name} (${ipAddress}:${port})`)
      return true
    } catch (error) {
      console.error('[WiFi Bookmarks] Error adding bookmark:', error)
      return false
    }
  }

  async removeBookmark(id: string): Promise<boolean> {
    try {
      const initialLength = this.bookmarks.length
      this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.id !== id)

      if (this.bookmarks.length < initialLength) {
        await this.saveBookmarks()
        console.log(`[WiFi Bookmarks] Removed bookmark with id: ${id}`)
        return true
      } else {
        console.log(`[WiFi Bookmarks] No bookmark found with id: ${id}`)
        return false
      }
    } catch (error) {
      console.error('[WiFi Bookmarks] Error removing bookmark:', error)
      return false
    }
  }

  async updateLastConnected(id: string): Promise<void> {
    try {
      const bookmark = this.bookmarks.find((b) => b.id === id)
      if (bookmark) {
        bookmark.lastConnected = new Date()
        await this.saveBookmarks()
        console.log(`[WiFi Bookmarks] Updated last connected time for bookmark: ${id}`)
      }
    } catch (error) {
      console.error('[WiFi Bookmarks] Error updating last connected time:', error)
    }
  }

  // Convert WiFi bookmarks to DeviceInfo objects for the device list
  getBookmarksAsDeviceInfo(): Array<{
    id: string
    type: 'wifi-bookmark'
    model: null
    isQuestDevice: false
    batteryLevel: null
    storageTotal: null
    storageFree: null
    friendlyModelName: string
    ipAddress: string
    bookmarkData: WiFiBookmark
  }> {
    return this.bookmarks.map((bookmark) => ({
      id: `wifi-bookmark:${bookmark.id}`,
      type: 'wifi-bookmark' as const,
      model: null,
      isQuestDevice: false,
      batteryLevel: null,
      storageTotal: null,
      storageFree: null,
      friendlyModelName: bookmark.name,
      ipAddress: bookmark.ipAddress,
      bookmarkData: bookmark
    }))
  }
}

export default new WiFiBookmarksService()
