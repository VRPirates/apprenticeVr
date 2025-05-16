import { createContext } from 'react'
import { UploadPreparationProgress } from '@shared/types'

export interface UploadContextType {
  isUploading: boolean
  progress: UploadPreparationProgress | null
  error: string | null
  prepareUpload: (
    packageName: string,
    gameName: string,
    versionCode: number,
    deviceId: string
  ) => Promise<string | null>
}

export const UploadContext = createContext<UploadContextType | undefined>(undefined)
