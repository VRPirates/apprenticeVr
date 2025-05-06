export type DownloadStatus =
  | 'Queued'
  | 'Downloading'
  | 'Completed'
  | 'Error'
  | 'Cancelled'
  | 'Extracting'
  | 'Installing'
  | 'InstallError'

export interface DownloadItem {
  gameId: string // GameInfo.id (unique identifier for the game)
  releaseName: string // Identifier for the specific download artifact
  gameName: string // For display purposes
  packageName: string // For display purposes
  status: DownloadStatus
  progress: number // 0-100
  error?: string // Error message if status is 'Error'
  downloadPath?: string // Final path where the game is downloaded
  pid?: number // Process ID of the running rclone command
  addedDate: number // Timestamp when added to queue
  thumbnailPath?: string // Store for easier display in download view
  speed?: string // Added speed string (e.g., "10.5 MiB/s")
  eta?: string // Added ETA string (e.g., "5m30s")
  extractProgress?: number // Added extraction progress (0-100)
}
