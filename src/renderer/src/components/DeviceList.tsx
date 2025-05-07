import React from 'react'
import { useAdb } from '../hooks/useAdb'
// Import Fluent UI components and icons
import {
  Button,
  Card,
  CardHeader,
  CardPreview,
  Spinner,
  Body1,
  Title3,
  makeStyles,
  tokens,
  shorthands,
  Text
} from '@fluentui/react-components'
import {
  DeviceMeetingRoomRegular,
  PlugDisconnectedRegular,
  ArrowClockwiseRegular as RefreshIcon,
  BatteryChargeRegular,
  StorageRegular,
  DismissCircleRegular,
  WarningRegular,
  ErrorCircleRegular
} from '@fluentui/react-icons'

interface DeviceListProps {
  onSkip?: () => void
  onConnected?: () => void
}

const useStyles = makeStyles({
  card: {
    width: '100%',
    maxWidth: '600px',
    margin: 'auto'
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
    cursor: 'default'
  },
  deviceInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM
  },
  deviceText: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingHorizontalXXS
  },
  deviceId: {
    fontWeight: tokens.fontWeightSemibold
  },
  deviceType: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200
  },
  deviceDetailsLine: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
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
  },
  warningText: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorPalettePumpkinBorderActive,
    fontSize: tokens.fontSizeBase200,
    marginTop: tokens.spacingVerticalXXS
  },
  deviceStatusText: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorPaletteRedBorderActive,
    fontSize: tokens.fontSizeBase200,
    marginTop: tokens.spacingVerticalXXS
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
    refreshDevices,
    disconnectDevice
  } = useAdb()
  const styles = useStyles()

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
            {onSkip && !isConnected && (
              <Button onClick={onSkip} appearance="secondary">
                Skip Connection
              </Button>
            )}
            {onSkip && isConnected && (
              <Button onClick={onSkip} appearance="secondary">
                Continue
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
            {devices.map((device) => {
              const isCurrentDeviceConnected = selectedDevice === device.id && isConnected
              const isConnectable = device.type === 'device' || device.type === 'emulator'
              const isKnownQuestDevice = device.isQuestDevice

              let deviceStatusMessage = ''
              if (device.type === 'offline') deviceStatusMessage = 'Offline'
              else if (device.type === 'unauthorized')
                deviceStatusMessage = 'Unauthorized - Check device'
              else if (device.type === 'unknown') deviceStatusMessage = 'Unknown State'

              return (
                <div key={device.id} className={styles.deviceItem}>
                  <div className={styles.deviceInfo}>
                    <DeviceMeetingRoomRegular fontSize={24} />
                    <div className={styles.deviceText}>
                      <Text weight="semibold" className={styles.deviceId}>
                        {device.friendlyModelName || device.model || device.id}
                      </Text>
                      <Text size={200} className={styles.deviceType}>
                        {device.friendlyModelName ? device.id : device.type}
                        {!isConnectable && deviceStatusMessage && ` - ${deviceStatusMessage}`}
                      </Text>

                      {/* Warning for connectable non-Quest devices */}
                      {isConnectable && !isKnownQuestDevice && (
                        <div className={styles.warningText}>
                          <WarningRegular fontSize={16} />
                          <Text size={200}>
                            Not a recognized Quest device. Connection may have unintended results.
                          </Text>
                        </div>
                      )}

                      {/* Status for non-connectable devices */}
                      {!isConnectable && deviceStatusMessage && (
                        <div className={styles.deviceStatusText}>
                          <ErrorCircleRegular fontSize={16} />
                          <Text size={200}>{deviceStatusMessage}</Text>
                        </div>
                      )}

                      {device.batteryLevel !== null && (
                        <div className={styles.deviceDetailsLine}>
                          <BatteryChargeRegular fontSize={16} />
                          <Text size={200}>{device.batteryLevel}%</Text>
                        </div>
                      )}
                      {device.storageFree !== null && device.storageTotal !== null && (
                        <div className={styles.deviceDetailsLine}>
                          <StorageRegular fontSize={16} />
                          <Text size={200}>
                            {`${device.storageFree} free / ${device.storageTotal} total`}
                          </Text>
                        </div>
                      )}
                    </div>
                  </div>
                  {isCurrentDeviceConnected ? (
                    <Button
                      icon={<DismissCircleRegular />}
                      onClick={disconnectDevice}
                      appearance="outline"
                      aria-label="Disconnect device"
                    >
                      Disconnect
                    </Button>
                  ) : isConnectable ? (
                    <Button
                      icon={<PlugDisconnectedRegular />}
                      appearance="outline"
                      onClick={() => handleConnect(device.id)}
                      disabled={isLoading}
                    >
                      Connect
                    </Button>
                  ) : (
                    // No button for non-connectable devices, or a disabled one if preferred
                    <Button icon={<PlugDisconnectedRegular />} appearance="outline" disabled={true}>
                      Cannot Connect
                    </Button>
                  )}
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
