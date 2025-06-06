import React, { useEffect, useState } from 'react'
import {
  Button,
  Text,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Badge,
  Spinner,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import { UpdateInfo } from '@shared/types'
import { ArrowDownloadRegular } from '@fluentui/react-icons'

const useStyles = makeStyles({
  updateContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM
  },
  releaseInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalM
  },
  highlightVersion: {
    fontWeight: 'bold',
    color: tokens.colorBrandForeground1
  },
  actionButtons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: tokens.spacingHorizontalM
  },
  spinnerContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS
  },
  contentWithIcon: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalM
  },
  icon: {
    fontSize: '24px',
    color: tokens.colorBrandForeground1
  }
})

export function UpdateNotification(): React.ReactElement | null {
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null)
  const [updateError, setUpdateError] = useState<Error | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const styles = useStyles()

  useEffect(() => {
    // Set up update listeners
    const removeCheckingListener = window.api.updates?.onCheckingForUpdate?.(() => {
      console.log('Checking for updates...')
      setIsChecking(true)
      setUpdateError(null)
    })

    const removeAvailableListener = window.api.updates?.onUpdateAvailable?.((info) => {
      console.log('Update available:', info)
      setUpdateAvailable(info)
      setIsChecking(false)
      // Automatically open dialog when update is available
      setIsDialogOpen(true)
    })

    const removeErrorListener = window.api.updates?.onUpdateError?.((error) => {
      console.error('Update error:', error)
      setUpdateError(error)
      setIsChecking(false)
    })

    return () => {
      // Clean up listeners on component unmount
      removeCheckingListener?.()
      removeAvailableListener?.()
      removeErrorListener?.()
    }
  }, [])

  const handleCheckForUpdates = async (): Promise<void> => {
    try {
      setIsChecking(true)
      await window.api.updates?.checkForUpdates?.()
    } catch (error) {
      console.error('Failed to check for updates:', error)
      setIsChecking(false)
    }
  }

  const handleDownload = (): void => {
    if (updateAvailable?.downloadUrl) {
      window.api.updates?.openDownloadPage?.(updateAvailable.downloadUrl)
      setIsDialogOpen(false)
    }
  }

  const handleViewReleases = (): void => {
    window.api.updates?.openReleasesPage?.()
  }

  const handleDismiss = (): void => {
    setIsDialogOpen(false)
  }

  // Don't render if there's nothing to show
  if (!updateAvailable && !isChecking && !updateError) {
    return null
  }

  let dialogTitle = 'Update Check'
  let dialogIcon: React.ReactNode = null
  let dialogContent: React.ReactNode = null

  if (isChecking) {
    dialogTitle = 'Checking for Updates'
    dialogContent = (
      <div className={styles.spinnerContainer}>
        <Spinner size="tiny" />
        <Text>Checking for the latest version...</Text>
      </div>
    )
  } else if (updateError) {
    dialogTitle = 'Update Error'
    dialogIcon = (
      <Badge appearance="filled" color="danger">
        Error
      </Badge>
    )
    dialogContent = (
      <div className={styles.updateContent}>
        <Text>Failed to check for updates: {updateError.message}</Text>
      </div>
    )
  } else if (updateAvailable) {
    dialogTitle = 'Update Available'
    dialogIcon = <ArrowDownloadRegular className={styles.icon} />
    dialogContent = (
      <div className={styles.updateContent}>
        <div className={styles.contentWithIcon}>
          <div className={styles.releaseInfo}>
            <Text size="large">
              A new version{' '}
              <span className={styles.highlightVersion}>{updateAvailable.version}</span> is
              available.
            </Text>

            {updateAvailable.releaseDate && (
              <Text size="small">
                Released: {new Date(updateAvailable.releaseDate).toLocaleDateString()}
              </Text>
            )}

            {updateAvailable.releaseNotes && (
              <div>
                <Text weight="semibold">What&apos;s new:</Text>
                <div style={{ marginTop: '8px' }}>
                  <div dangerouslySetInnerHTML={{ __html: updateAvailable.releaseNotes }} />
                </div>
              </div>
            )}

            <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #e0e0e0' }}>
              <Text size="small" style={{ color: '#666' }}>
                Visit the{' '}
                <Button
                  appearance="transparent"
                  size="small"
                  onClick={() => window.api.updates?.openRepositoryPage?.()}
                  style={{ padding: '0', height: 'auto', minHeight: 'auto' }}
                >
                  GitHub repository (https://github.com/jimzrt/apprenticeVr)
                </Button>{' '}
                for full changelog and project details.
              </Text>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={(_, { open }) => setIsDialogOpen(open)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            {dialogIcon && <span style={{ marginRight: '8px' }}>{dialogIcon}</span>}
            {dialogTitle}
          </DialogTitle>

          <DialogContent>{dialogContent}</DialogContent>

          <DialogActions>
            {updateError ? (
              <>
                <Button appearance="secondary" onClick={handleDismiss}>
                  Dismiss
                </Button>
                <Button appearance="primary" onClick={handleCheckForUpdates}>
                  Try Again
                </Button>
              </>
            ) : updateAvailable ? (
              <>
                <Button appearance="secondary" onClick={handleDismiss}>
                  Remind Me Later
                </Button>
                <Button appearance="secondary" onClick={handleViewReleases}>
                  View Releases
                </Button>
                <Button
                  appearance="primary"
                  onClick={handleDownload}
                  disabled={!updateAvailable.downloadUrl}
                  icon={<ArrowDownloadRegular />}
                >
                  Download Update
                </Button>
              </>
            ) : (
              <Button appearance="secondary" onClick={handleDismiss}>
                Close
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
