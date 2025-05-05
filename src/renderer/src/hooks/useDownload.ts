// import React from 'react' // Removed unused import
import { useContext } from 'react'
import { DownloadContext, DownloadContextType } from '../context/DownloadContext'

export const useDownload = (): DownloadContextType => {
  const context = useContext(DownloadContext)
  if (context === undefined) {
    throw new Error('useDownload must be used within a DownloadProvider')
  }
  return context
}
