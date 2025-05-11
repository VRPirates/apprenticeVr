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
  useToastController,
  Title2,
  Subtitle1
} from '@fluentui/react-components'
import { FolderOpenRegular, CheckmarkCircleRegular, InfoRegular } from '@fluentui/react-icons'
import { useSettings } from '../hooks/useSettings'

const useStyles = makeStyles({
  root: {
    padding: tokens.spacingVerticalXL,
    maxWidth: '1200px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL
  },
  headerSection: {
    marginBottom: tokens.spacingVerticalL
  },
  headerTitle: {
    marginBottom: tokens.spacingVerticalXS
  },
  headerSubtitle: {
    color: tokens.colorNeutralForeground2,
    display: 'block',
    marginBottom: tokens.spacingVerticalL
  },
  section: {
    marginBottom: tokens.spacingVerticalXL
  },
  card: {
    width: '100%',
    boxShadow: tokens.shadow4,
    borderRadius: tokens.borderRadiusMedium
  },
  cardContent: {
    padding: tokens.spacingHorizontalL,
    paddingBottom: tokens.spacingVerticalXL
  },
  formRow: {
    display: 'flex',
    alignItems: 'center',
    marginTop: tokens.spacingVerticalM,
    gap: tokens.spacingHorizontalM,
    width: '100%',
    maxWidth: '800px'
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
  },
  hint: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground2
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '200px'
          }}
        >
          <Spinner size="large" label="Loading settings..." />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.headerSection}>
        <Title2 className={styles.headerTitle}>Application Settings</Title2>
        <Text as="p" className={styles.headerSubtitle}>
          Configure application preferences and manage your downloads
        </Text>
      </div>

      <Card className={styles.card}>
        <CardHeader>
          <Subtitle1 weight="semibold">Download Settings</Subtitle1>
        </CardHeader>
        <Divider />
        <div className={styles.cardContent}>
          <Text>Set where your games will be downloaded and stored on your device</Text>

          <div className={styles.formRow}>
            <Input
              className={styles.input}
              value={editedDownloadPath}
              onChange={(e, data) => setEditedDownloadPath(data.value)}
              placeholder="Download path"
              contentAfter={
                <Button
                  icon={<FolderOpenRegular />}
                  onClick={handleSelectFolder}
                  aria-label="Browse folders"
                />
              }
              size="large"
            />
            <Button onClick={handleSaveDownloadPath} appearance="primary" size="large">
              Save Path
            </Button>
          </div>

          {(error || localError) && <Text className={styles.error}>{error || localError}</Text>}

          {saveSuccess && (
            <Text className={styles.success}>
              <CheckmarkCircleRegular />
              Settings saved successfully
            </Text>
          )}

          <Text className={styles.hint}>
            <InfoRegular />
            This is where downloaded games will be stored on your computer
          </Text>
        </div>
      </Card>

      {/* Add more settings sections here as needed */}
      {/* 
      <Card className={styles.card}>
        <CardHeader>
          <Subtitle1 weight="semibold">Other Settings</Subtitle1>
        </CardHeader>
        <Divider />
        <div className={styles.cardContent}>
          // Additional settings UI
        </div>
      </Card>
      */}
    </div>
  )
}

export default Settings
