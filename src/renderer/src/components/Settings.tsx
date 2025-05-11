import React, { useState, useEffect, useRef } from 'react'
import {
  Card,
  CardHeader,
  Text,
  Button,
  Input,
  makeStyles,
  tokens,
  Spinner,
  Title2,
  Subtitle1,
  Dropdown,
  Option
} from '@fluentui/react-components'
import { FolderOpenRegular, CheckmarkCircleRegular, InfoRegular } from '@fluentui/react-icons'
import { useSettings } from '../hooks/useSettings'

// Supported speed units with conversion factors to KB/s
const SPEED_UNITS = [
  { label: 'KB/s', value: 'kbps', factor: 1 },
  { label: 'MB/s', value: 'mbps', factor: 1024 }
]

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
  },
  speedLimitSection: {
    marginTop: tokens.spacingVerticalL
  },
  speedFormRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalM,
    width: '100%',
    maxWidth: '800px'
  },
  speedControl: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS
  },
  speedInputGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS
  },
  speedInput: {
    width: '140px',
    flexGrow: 1
  },
  unitDropdown: {
    width: '80px',
    minWidth: '80px'
  }
})

const Settings: React.FC = () => {
  const styles = useStyles()
  const {
    downloadPath,
    downloadSpeedLimit,
    uploadSpeedLimit,
    isLoading,
    error,
    setDownloadPath,
    setDownloadSpeedLimit,
    setUploadSpeedLimit
  } = useSettings()
  const [editedDownloadPath, setEditedDownloadPath] = useState(downloadPath)

  // New state for speed input values
  const [downloadSpeedInput, setDownloadSpeedInput] = useState(
    downloadSpeedLimit > 0 ? String(downloadSpeedLimit) : ''
  )
  const [uploadSpeedInput, setUploadSpeedInput] = useState(
    uploadSpeedLimit > 0 ? String(uploadSpeedLimit) : ''
  )
  const [downloadSpeedUnit, setDownloadSpeedUnit] = useState(SPEED_UNITS[0].value)
  const [uploadSpeedUnit, setUploadSpeedUnit] = useState(SPEED_UNITS[0].value)

  // Add refs to store original values in KB/s
  const originalDownloadKbps = useRef<number | null>(null)
  const originalUploadKbps = useRef<number | null>(null)

  const [localError, setLocalError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Update local state when the context values change
  useEffect(() => {
    setEditedDownloadPath(downloadPath)

    // Handle new download/upload speed state
    if (downloadSpeedLimit === 0) {
      setDownloadSpeedInput('')
      originalDownloadKbps.current = null
    } else {
      setDownloadSpeedInput(String(downloadSpeedLimit))
      setDownloadSpeedUnit('kbps') // Always reset to KB/s when loading from settings
      originalDownloadKbps.current = downloadSpeedLimit
    }

    if (uploadSpeedLimit === 0) {
      setUploadSpeedInput('')
      originalUploadKbps.current = null
    } else {
      setUploadSpeedInput(String(uploadSpeedLimit))
      setUploadSpeedUnit('kbps') // Always reset to KB/s when loading from settings
      originalUploadKbps.current = uploadSpeedLimit
    }
  }, [downloadPath, downloadSpeedLimit, uploadSpeedLimit])

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

      // Reset success message after 3 seconds
      setTimeout(() => {
        setSaveSuccess(false)
      }, 3000)
    } catch (err) {
      console.error('Error saving download path:', err)
      setLocalError('Failed to save download path')
    }
  }

  const handleSaveSpeedLimits = async (): Promise<void> => {
    try {
      setLocalError(null)
      setSaveSuccess(false)

      // Use the stored original KB/s values if available, otherwise calculate
      let downloadLimit: number
      let uploadLimit: number

      if (downloadSpeedInput.trim() === '') {
        downloadLimit = 0
      } else if (originalDownloadKbps.current !== null) {
        downloadLimit = originalDownloadKbps.current
      } else {
        const inputValue = parseFloat(downloadSpeedInput)
        if (isNaN(inputValue)) {
          setLocalError('Please enter valid numbers for speed limits')
          return
        }
        const factor = SPEED_UNITS.find((u) => u.value === downloadSpeedUnit)?.factor || 1
        downloadLimit = inputValue * factor
      }

      if (uploadSpeedInput.trim() === '') {
        uploadLimit = 0
      } else if (originalUploadKbps.current !== null) {
        uploadLimit = originalUploadKbps.current
      } else {
        const inputValue = parseFloat(uploadSpeedInput)
        if (isNaN(inputValue)) {
          setLocalError('Please enter valid numbers for speed limits')
          return
        }
        const factor = SPEED_UNITS.find((u) => u.value === uploadSpeedUnit)?.factor || 1
        uploadLimit = inputValue * factor
      }

      // Ensure values are non-negative
      downloadLimit = Math.max(0, downloadLimit)
      uploadLimit = Math.max(0, uploadLimit)

      // Round to integer for storage (as the API expects integers)
      const roundedDownloadLimit = Math.round(downloadLimit)
      const roundedUploadLimit = Math.round(uploadLimit)

      await setDownloadSpeedLimit(roundedDownloadLimit)
      await setUploadSpeedLimit(roundedUploadLimit)

      // Show success message
      setSaveSuccess(true)

      // Reset success message after 3 seconds
      setTimeout(() => {
        setSaveSuccess(false)
      }, 3000)
    } catch (err) {
      console.error('Error saving speed limits:', err)
      setLocalError('Failed to save speed limits')
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

  // Handle unit conversion when dropdown changes
  const handleDownloadUnitChange = (newUnit: string): void => {
    if (!downloadSpeedInput.trim()) {
      // If input is empty, just change the unit
      setDownloadSpeedUnit(newUnit)
      return
    }

    const currentValue = parseFloat(downloadSpeedInput)
    if (isNaN(currentValue)) {
      // If current input is not a valid number, just change the unit
      setDownloadSpeedUnit(newUnit)
      return
    }

    const currentUnitValue = SPEED_UNITS.find((u) => u.value === downloadSpeedUnit)
    const newUnitValue = SPEED_UNITS.find((u) => u.value === newUnit)

    if (!currentUnitValue || !newUnitValue) {
      setDownloadSpeedUnit(newUnit)
      return
    }

    // If this is the first unit change, store the original KB/s value
    if (originalDownloadKbps.current === null) {
      if (downloadSpeedUnit === 'kbps') {
        originalDownloadKbps.current = currentValue
      } else {
        // Convert from current unit to KB/s
        originalDownloadKbps.current = currentValue * currentUnitValue.factor
      }
    }

    // Use the original KB/s value for conversions to prevent rounding errors
    if (originalDownloadKbps.current !== null) {
      const valueInNewUnit = originalDownloadKbps.current / newUnitValue.factor

      // Format based on the unit
      let formattedValue: string
      if (newUnit === 'mbps') {
        // For MB/s, show up to 2 decimal places, but trim trailing zeros
        formattedValue = valueInNewUnit.toFixed(2).replace(/\.?0+$/, '')
        if (formattedValue.endsWith('.')) formattedValue = formattedValue.slice(0, -1)
      } else {
        // For KB/s, show as integer
        formattedValue = Math.round(valueInNewUnit).toString()
      }

      setDownloadSpeedInput(formattedValue)
    }

    setDownloadSpeedUnit(newUnit)
  }

  const handleUploadUnitChange = (newUnit: string): void => {
    if (!uploadSpeedInput.trim()) {
      // If input is empty, just change the unit
      setUploadSpeedUnit(newUnit)
      return
    }

    const currentValue = parseFloat(uploadSpeedInput)
    if (isNaN(currentValue)) {
      // If current input is not a valid number, just change the unit
      setUploadSpeedUnit(newUnit)
      return
    }

    const currentUnitValue = SPEED_UNITS.find((u) => u.value === uploadSpeedUnit)
    const newUnitValue = SPEED_UNITS.find((u) => u.value === newUnit)

    if (!currentUnitValue || !newUnitValue) {
      setUploadSpeedUnit(newUnit)
      return
    }

    // If this is the first unit change, store the original KB/s value
    if (originalUploadKbps.current === null) {
      if (uploadSpeedUnit === 'kbps') {
        originalUploadKbps.current = currentValue
      } else {
        // Convert from current unit to KB/s
        originalUploadKbps.current = currentValue * currentUnitValue.factor
      }
    }

    // Use the original KB/s value for conversions to prevent rounding errors
    if (originalUploadKbps.current !== null) {
      const valueInNewUnit = originalUploadKbps.current / newUnitValue.factor

      // Format based on the unit
      let formattedValue: string
      if (newUnit === 'mbps') {
        // For MB/s, show up to 2 decimal places, but trim trailing zeros
        formattedValue = valueInNewUnit.toFixed(2).replace(/\.?0+$/, '')
        if (formattedValue.endsWith('.')) formattedValue = formattedValue.slice(0, -1)
      } else {
        // For KB/s, show as integer
        formattedValue = Math.round(valueInNewUnit).toString()
      }

      setUploadSpeedInput(formattedValue)
    }

    setUploadSpeedUnit(newUnit)
  }

  // Update stored KB/s value when input changes
  const handleDownloadInputChange = (value: string): void => {
    setDownloadSpeedInput(value.replace(/[^0-9.]/g, ''))

    // If the input is valid, update the original KB/s value
    const numValue = parseFloat(value)
    if (!isNaN(numValue)) {
      if (downloadSpeedUnit === 'kbps') {
        originalDownloadKbps.current = numValue
      } else {
        const factor = SPEED_UNITS.find((u) => u.value === downloadSpeedUnit)?.factor || 1
        originalDownloadKbps.current = numValue * factor
      }
    } else if (value.trim() === '') {
      originalDownloadKbps.current = null
    }
  }

  const handleUploadInputChange = (value: string): void => {
    setUploadSpeedInput(value.replace(/[^0-9.]/g, ''))

    // If the input is valid, update the original KB/s value
    const numValue = parseFloat(value)
    if (!isNaN(numValue)) {
      if (uploadSpeedUnit === 'kbps') {
        originalUploadKbps.current = numValue
      } else {
        const factor = SPEED_UNITS.find((u) => u.value === uploadSpeedUnit)?.factor || 1
        originalUploadKbps.current = numValue * factor
      }
    } else if (value.trim() === '') {
      originalUploadKbps.current = null
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
        <div className={styles.cardContent}>
          <Text>Set where your games will be downloaded and stored on your device</Text>

          <div className={styles.formRow}>
            <Input
              className={styles.input}
              value={editedDownloadPath}
              onChange={(_, data) => setEditedDownloadPath(data.value)}
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

          <div className={styles.speedLimitSection}>
            <Text>Configure download and upload speed limits</Text>

            <div className={styles.speedFormRow}>
              <div className={styles.speedControl}>
                <Text>Download Speed Limit</Text>
                <div className={styles.speedInputGroup}>
                  <Input
                    className={styles.speedInput}
                    value={downloadSpeedInput}
                    onChange={(_, data) => handleDownloadInputChange(data.value)}
                    placeholder="Unlimited"
                  />
                  <Dropdown
                    className={styles.unitDropdown}
                    value={SPEED_UNITS.find((u) => u.value === downloadSpeedUnit)?.label}
                    label="Download Speed Limit Unit"
                    selectedOptions={[downloadSpeedUnit]}
                    onOptionSelect={(_, data) => {
                      if (data.optionValue) {
                        handleDownloadUnitChange(data.optionValue)
                      }
                    }}
                    mountNode={document.getElementById('portal')}
                  >
                    {SPEED_UNITS.map((unit) => (
                      <Option key={unit.value} value={unit.value} text={unit.label}>
                        {unit.label}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
                <Text className={styles.hint}>
                  <InfoRegular />
                  Leave empty for unlimited download speed
                </Text>
              </div>

              <div className={styles.speedControl}>
                <Text>Upload Speed Limit</Text>
                <div className={styles.speedInputGroup}>
                  <Input
                    className={styles.speedInput}
                    value={uploadSpeedInput}
                    onChange={(_, data) => handleUploadInputChange(data.value)}
                    placeholder="Unlimited"
                  />
                  <Dropdown
                    className={styles.unitDropdown}
                    value={SPEED_UNITS.find((u) => u.value === uploadSpeedUnit)?.label}
                    selectedOptions={[uploadSpeedUnit]}
                    onOptionSelect={(_, data) => {
                      if (data.optionValue) {
                        handleUploadUnitChange(data.optionValue)
                      }
                    }}
                    mountNode={document.getElementById('portal')}
                  >
                    {SPEED_UNITS.map((unit) => (
                      <Option key={unit.value} value={unit.value} text={unit.label}>
                        {unit.label}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
                <Text className={styles.hint}>
                  <InfoRegular />
                  Leave empty for unlimited upload speed
                </Text>
              </div>
            </div>

            <div
              className={styles.formRow}
              style={{ justifyContent: 'flex-end', marginTop: tokens.spacingVerticalM }}
            >
              <Button onClick={handleSaveSpeedLimits} appearance="primary" size="large">
                Save Speed Limits
              </Button>
            </div>
          </div>

          {(error || localError) && <Text className={styles.error}>{error || localError}</Text>}

          {saveSuccess && (
            <Text className={styles.success}>
              <CheckmarkCircleRegular />
              Settings saved successfully
            </Text>
          )}
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
