import { useState, useCallback } from 'react'

export const useLogs = (): {
  isUploading: boolean
  uploadError: string | null
  uploadSuccess: boolean
  shareableUrl: string | null
  uploadCurrentLog: () => Promise<void>
  clearUploadState: () => void
} => {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [shareableUrl, setShareableUrl] = useState<string | null>(null)

  const uploadCurrentLog = useCallback(async (): Promise<void> => {
    try {
      setIsUploading(true)
      setUploadError(null)
      setUploadSuccess(false)
      setShareableUrl(null)

      const url = await window.api.logs.uploadCurrentLog()

      if (url) {
        setShareableUrl(url)
        setUploadSuccess(true)
      } else {
        setUploadError('Failed to upload log file. Please try again.')
      }
    } catch (error) {
      console.error('Error uploading log file:', error)
      setUploadError('Failed to upload log file. Please try again.')
    } finally {
      setIsUploading(false)
    }
  }, [])

  const clearUploadState = useCallback(() => {
    setUploadError(null)
    setUploadSuccess(false)
    setShareableUrl(null)
  }, [])

  return {
    isUploading,
    uploadError,
    uploadSuccess,
    shareableUrl,
    uploadCurrentLog,
    clearUploadState
  }
}
