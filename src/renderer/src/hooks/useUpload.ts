import { useContext } from 'react'
import { UploadContext, UploadContextType } from '../context/UploadContext'

export const useUpload = (): UploadContextType => {
  const context = useContext(UploadContext)

  if (context === undefined) {
    throw new Error('useUpload must be used within an UploadProvider')
  }

  return context
}
