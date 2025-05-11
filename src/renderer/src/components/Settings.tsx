import React, { useState, useEffect } from 'react'
import {
  Card,
  CardHeader,
  Text,
  Button,
  Input,
  makeStyles,
  tokens,
  Spinner,
  Divider,
  Toaster,
  ToastTitle,
  useToastController
} from '@fluentui/react-components'
import { FolderOpenRegular, CheckmarkCircleRegular } from '@fluentui/react-icons'
import { useSettings } from '../hooks/useSettings'

const useStyles = makeStyles({
  root: {
    padding: tokens.spacingVerticalM,
    maxWidth: '800px',
    margin: '0 auto'
  },
  section: {
    marginBottom: tokens.spacingVerticalL
  },
  formRow: {
    display: 'flex',
    alignItems: 'center',
    marginTop: tokens.spacingVerticalS,
    gap: tokens.spacingHorizontalM
  },
  input: {
    flexGrow: 1
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    marginTop: tokens.spacingVerticalXS
  },
  success: {
    color: tokens.colorPaletteGreenForeground1,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXS
  }
})

const Settings: React.FC = () => {
  const styles = useStyles()
  const { downloadPath, isLoading, error, setDownloadPath } = useSettings()
  const [editedDownloadPath, setEditedDownloadPath] = useState(downloadPath)
  const [localError, setLocalError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const { dispatchToast } = useToastController()

  // Update local state when the context values change
  useEffect(() => {
    setEditedDownloadPath(downloadPath)
  }, [downloadPath])

  const handleSaveDownloadPath = async (): Promise<void> => {
    if (!editedDownloadPath) {
      setLocalError('Download path cannot be empty')
      return
    }

    try {
      setLocalError(null)
      setSaveSuccess(false)
      await setDownloadPath(editedDownloadPath)

      // Show success message
      setSaveSuccess(true)

      // Show a toast notification
      dispatchToast(
        <Toaster>
          <ToastTitle media={<CheckmarkCircleRegular />}>
            Download path saved successfully
          </ToastTitle>
        </Toaster>,
        { position: 'bottom-end', timeout: 3000 }
      )

      // Reset success message after 3 seconds
      setTimeout(() => {
        setSaveSuccess(false)
      }, 3000)
    } catch (err) {
      console.error('Error saving download path:', err)
      setLocalError('Failed to save download path')
    }
  }

  const handleSelectFolder = async (): Promise<void> => {
    try {
      const selectedPath = await window.api.dialog.showDirectoryPicker()
      if (selectedPath) {
        setEditedDownloadPath(selectedPath)
      }
    } catch (err) {
      console.error('Error selecting folder:', err)
      setLocalError('Failed to select folder')
    }
  }

  if (isLoading) {
    return (
      <div className={styles.root}>
        <Spinner size="tiny" />
        <Text>Loading settings...</Text>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <Card>
        <CardHeader header={<Text weight="semibold">Application Settings</Text>} />

        <div className={styles.section}>
          <Text weight="semibold">Download Settings</Text>
          <Divider />

          <div className={styles.formRow}>
            <Input
              className={styles.input}
              value={editedDownloadPath}
              onChange={(e, data) => setEditedDownloadPath(data.value)}
              placeholder="Download path"
              contentAfter={<Button icon={<FolderOpenRegular />} onClick={handleSelectFolder} />}
            />
            <Button onClick={handleSaveDownloadPath}>Save</Button>
          </div>

          {(error || localError) && <Text className={styles.error}>{error || localError}</Text>}

          {saveSuccess && (
            <Text className={styles.success}>
              <CheckmarkCircleRegular />
              Settings saved successfully
            </Text>
          )}

          <Text size="small" style={{ marginTop: tokens.spacingVerticalXS }}>
            This is where downloaded games will be stored
          </Text>
        </div>
      </Card>
    </div>
  )
}

export default Settings
