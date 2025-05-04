import React from 'react'
import { useAdb } from '../hooks/useAdb'
// Import Fluent UI components and icons
import {
  Button,
  Card,
  CardHeader,
  CardPreview,
  Spinner,
  Body1, // For messages like "No devices found"
  Title3, // For the card title
  makeStyles,
  tokens,
  shorthands,
  Text // To display device ID/Type
  // Badge // Removed unused import
} from '@fluentui/react-components'
import {
  DeviceMeetingRoomRegular, // Icon for devices
  PlugDisconnectedRegular,
  PlugConnectedRegular,
  ArrowClockwiseRegular as RefreshIcon // Use a different icon for Refresh
} from '@fluentui/react-icons'

interface DeviceListProps {
  onSkip?: () => void
  onConnected?: () => void
}

// Fluent UI Styles
const useStyles = makeStyles({
  card: {
    width: '100%',
    maxWidth: '600px', // Limit width
    margin: 'auto' // Center the card
  },
  headerActions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS
  },
  deviceListContainer: {
    marginTop: tokens.spacingVerticalL,
    marginBottom: tokens.spacingVerticalL
  },
  deviceItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalM),
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover
    },
    cursor: 'default' // Default cursor, connect button is clickable
  },
  deviceInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM
  },
  deviceText: {
    display: 'flex',
    flexDirection: 'column'
  },
  deviceId: {
    fontWeight: tokens.fontWeightSemibold
  },
  deviceType: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200
  },
  statusBadge: {
    marginLeft: tokens.spacingHorizontalS
  },
  messageArea: {
    textAlign: 'center',
    padding: tokens.spacingVerticalXXL,
    color: tokens.colorNeutralForeground2
  }
})

const DeviceList: React.FC<DeviceListProps> = ({ onSkip, onConnected }) => {
  const {
    devices,
    selectedDevice,
    isConnected,
    isLoading,
    error,
    connectToDevice,
    refreshDevices
  } = useAdb()
  const styles = useStyles()

  // Connect to a device and call onConnected callback if provided
  const handleConnect = async (serial: string): Promise<void> => {
    const success = await connectToDevice(serial)
    if (success && onConnected) {
      onConnected()
    }
  }

  return (
    <Card className={styles.card}>
      <CardHeader
        header={<Title3>Meta Quest Devices</Title3>}
        action={
          <div className={styles.headerActions}>
            <Button
              icon={<RefreshIcon />}
              onClick={() => refreshDevices()}
              disabled={isLoading}
              appearance="subtle"
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </Button>
            {onSkip && (
              <Button onClick={onSkip} appearance="secondary">
                Skip Connection
              </Button>
            )}
          </div>
        }
      />

      <CardPreview className={styles.deviceListContainer}>
        {error && (
          <Body1 className={styles.messageArea}>Error: {error}</Body1> // Show error clearly
        )}
        {!error && isLoading && devices.length === 0 && (
          <div className={styles.messageArea}>
            <Spinner size="small" /> Searching for devices...
          </div>
        )}
        {!error && !isLoading && devices.length === 0 && (
          <Body1 className={styles.messageArea}>
            No devices found. Ensure device is connected and in ADB mode.
          </Body1>
        )}
        {!error && devices.length > 0 && (
          <div>
            {' '}
            {/* Use a simple div for the list for now */}
            {devices.map((device) => {
              const isCurrentDeviceConnected = selectedDevice === device.id && isConnected
              return (
                <div key={device.id} className={styles.deviceItem}>
                  <div className={styles.deviceInfo}>
                    <DeviceMeetingRoomRegular fontSize={24} />
                    <div className={styles.deviceText}>
                      <Text weight="semibold" className={styles.deviceId}>
                        {device.id}
                      </Text>
                      <Text size={200} className={styles.deviceType}>
                        {device.type}
                      </Text>
                    </div>
                  </div>
                  <Button
                    icon={
                      isCurrentDeviceConnected ? (
                        <PlugConnectedRegular />
                      ) : (
                        <PlugDisconnectedRegular />
                      )
                    }
                    appearance={isCurrentDeviceConnected ? 'primary' : 'outline'}
                    onClick={() => handleConnect(device.id)}
                    disabled={isCurrentDeviceConnected || isLoading} // Disable connect if loading
                  >
                    {isCurrentDeviceConnected ? 'Connected' : 'Connect'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </CardPreview>
    </Card>
  )
}

export default DeviceList
