import React, { ReactNode, useEffect, useState, useCallback } from 'react'
import { UploadContext, UploadContextType } from './UploadContext'
import { UploadPreparationProgress } from '@shared/types'

interface UploadProviderProps {
  children: ReactNode
}

export const UploadProvider: React.FC<UploadProviderProps> = ({ children }) => {
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [progress, setProgress] = useState<UploadPreparationProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    // Set up progress listener
    const removeProgressListener = window.api.uploads.onUploadProgress((progressData) => {
      if (isMounted) {
        setProgress(progressData)
        console.log('Upload progress:', progressData)

        // Reset isUploading when upload is complete
        if (progressData.stage === 'Complete') {
          setIsUploading(false)
        } else if (progressData.stage === 'Error') {
          setError('Upload preparation failed')
          setIsUploading(false)
        }
      }
    })

    return () => {
      isMounted = false
      removeProgressListener()
    }
  }, [])

  const prepareUpload = useCallback(
    async (
      packageName: string,
      gameName: string,
      versionCode: number,
      deviceId: string
    ): Promise<string | null> => {
      setError(null)
      setIsUploading(true)

      try {
        const result = await window.api.uploads.prepareUpload(
          packageName,
          gameName,
          versionCode,
          deviceId
        )

        if (!result) {
          setError('Failed to prepare upload')
          setIsUploading(false)
        }

        return result
      } catch (err) {
        console.error('Error preparing upload:', err)
        setError(err instanceof Error ? err.message : 'Unknown error during upload preparation')
        setIsUploading(false)
        return null
      }
    },
    []
  )

  const value: UploadContextType = {
    isUploading,
    progress,
    error,
    prepareUpload
  }

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
}
