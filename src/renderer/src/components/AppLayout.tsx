import React, { useRef, useState, useMemo } from 'react'
import { AdbProvider } from '../context/AdbProvider'
import { GamesProvider } from '../context/GamesProvider'
import DeviceList from './DeviceList'
import GamesView from './GamesView'
import DownloadsView from './DownloadsView'
import {
  FluentProvider,
  Title1,
  makeStyles,
  tokens,
  Spinner,
  Text,
  teamsDarkTheme,
  teamsLightTheme,
  Switch,
  Button,
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody
} from '@fluentui/react-components'
import electronLogo from '../assets/icon.svg'
import { useDependency } from '../hooks/useDependency'
import { DependencyProvider } from '../context/DependencyProvider'
import { DownloadProvider } from '../context/DownloadProvider'
import { useDownload } from '../hooks/useDownload'
import {
  ArrowDownloadRegular as DownloadIcon,
  DismissRegular as CloseIcon
} from '@fluentui/react-icons'

enum AppView {
  DEVICE_LIST,
  GAMES
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground3,
    gap: tokens.spacingHorizontalM,
    justifyContent: 'space-between'
  },
  logo: {
    height: '48px'
  },
  headerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM
  },
  mainContent: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column'
  },
  loadingOrErrorContainer: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalL
  }
})

// Define props for the inner MainContent component
interface MainContentProps {
  currentView: AppView
  onDeviceConnected: () => void
  onSkipConnection: () => void
  onBackToDeviceList: () => void
}

// Inner component that consumes the DependencyContext
const MainContent: React.FC<MainContentProps> = ({
  currentView,
  onDeviceConnected,
  onSkipConnection,
  onBackToDeviceList
}) => {
  const styles = useStyles()
  const {
    isReady: dependenciesReady,
    error: dependencyError,
    progress: dependencyProgress,
    status: dependencyStatus
  } = useDependency()

  // Render function based on view
  const renderCurrentView = (): React.ReactNode => {
    switch (currentView) {
      case AppView.DEVICE_LIST:
        return <DeviceList onConnected={onDeviceConnected} onSkip={onSkipConnection} />
      case AppView.GAMES:
        return <GamesView onBackToDevices={onBackToDeviceList} />
      default:
        // Fallback to Device List if view is unknown
        return <DeviceList onConnected={onDeviceConnected} onSkip={onSkipConnection} />
    }
  }

  if (!dependenciesReady) {
    if (dependencyError) {
      const errorDetails: string[] = []
      if (!dependencyStatus?.sevenZip.ready) errorDetails.push('7zip')
      // Add rclone check later
      const failedDeps = errorDetails.length > 0 ? ` (${errorDetails.join(', ')})` : ''

      return (
        <div className={styles.loadingOrErrorContainer}>
          <Text weight="semibold" style={{ color: tokens.colorPaletteRedForeground1 }}>
            Dependency Error{failedDeps}
          </Text>
          <Text>{dependencyError}</Text>
          {/* Add instructions or retry logic? */}
        </div>
      )
    }
    // Show progress if available - only rclone needs downloading/extracting now
    let progressText = 'Checking requirements...'
    console.log('dependencyStatus', dependencyStatus)
    console.log('dependencyProgress', dependencyProgress)
    if (dependencyStatus?.rclone.downloading && dependencyProgress) {
      // Show specific rclone progress only if it's downloading
      progressText = `Setting up ${dependencyProgress.name}... ${dependencyProgress.percentage}%`
      if (dependencyProgress.name === 'rclone-extract') {
        progressText = `Extracting ${dependencyProgress.name.replace('-extract', '')}...`
      }
    } else if (dependencyStatus?.adb.downloading && dependencyProgress) {
      // Show specific adb progress if it's downloading/extracting
      progressText = `Setting up ${dependencyProgress.name}... ${dependencyProgress.percentage}%`
      if (dependencyProgress.name === 'adb-extract') {
        progressText = `Extracting ${dependencyProgress.name.replace('-extract', '')}...`
      }
    } else if (
      dependencyStatus &&
      (!dependencyStatus.sevenZip.ready ||
        !dependencyStatus.rclone.ready ||
        !dependencyStatus.adb.ready) // Added adb check
    ) {
      // Generic checking message if not downloading but still not ready
      progressText = 'Setting up requirements...'
    }
    // If all deps are ready, this block is skipped anyway by the `if (!dependenciesReady)` check above

    return (
      <div className={styles.loadingOrErrorContainer}>
        <Spinner size="huge" />
        <Text>{progressText}</Text>
      </div>
    )
  }

  // Dependencies are ready, render the rest of the app providers here
  return (
    <AdbProvider>
      <GamesProvider>{renderCurrentView()}</GamesProvider>
    </AdbProvider>
  )
}

const AppLayout: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.DEVICE_LIST)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isDownloadsOpen, setIsDownloadsOpen] = useState(false)
  const mountNodeRef = useRef<HTMLDivElement>(null)
  const styles = useStyles()
  const { queue: downloadQueue } = useDownload()

  const handleDeviceConnected = (): void => {
    setCurrentView(AppView.GAMES)
  }

  const handleSkipConnection = (): void => {
    setCurrentView(AppView.GAMES)
  }

  const handleBackToDeviceList = (): void => {
    setCurrentView(AppView.DEVICE_LIST)
  }

  const currentTheme = isDarkMode ? teamsDarkTheme : teamsLightTheme

  const handleThemeChange = (_ev, data): void => {
    setIsDarkMode(data.checked)
  }

  // --- Calculate Download Summary --- START
  const activeDownloads = useMemo(() => {
    return downloadQueue.filter(
      (item) => item.status === 'Downloading' || item.status === 'Extracting'
    ).length
  }, [downloadQueue])

  const queuedDownloads = useMemo(() => {
    return downloadQueue.filter((item) => item.status === 'Queued').length
  }, [downloadQueue])

  const getDownloadButtonContent = (): { icon: React.ReactNode; text: string } => {
    if (activeDownloads > 0) {
      return {
        icon: <Spinner size="tiny" style={{ animationDuration: '1s' }} />,
        text: `Downloading (${activeDownloads})`
      }
    } else if (queuedDownloads > 0) {
      return {
        icon: <DownloadIcon />,
        text: `Queued (${queuedDownloads})`
      }
    } else {
      return {
        icon: <DownloadIcon />,
        text: 'Downloads'
      }
    }
  }

  const { icon: downloadButtonIcon, text: downloadButtonText } = getDownloadButtonContent()
  // --- Calculate Download Summary --- END

  return (
    <FluentProvider theme={currentTheme}>
      <DependencyProvider>
        <div className={styles.root}>
          <div className={styles.header}>
            <div className={styles.headerContent}>
              <img alt="logo" className={styles.logo} src={electronLogo} />
              <Title1>Apprentice VR</Title1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalL }}>
              {currentView !== AppView.DEVICE_LIST && (
                <Button
                  onClick={() => {
                    console.log('[AppLayout] Downloads button clicked')
                    setIsDownloadsOpen(true)
                  }}
                  icon={downloadButtonIcon}
                >
                  {downloadButtonText}
                </Button>
              )}
              <Switch
                label={isDarkMode ? 'Dark mode' : 'Light mode'}
                checked={isDarkMode}
                onChange={handleThemeChange}
              />
            </div>
          </div>
          <div className={styles.mainContent} id="mainContent">
            <MainContent
              currentView={currentView}
              onDeviceConnected={handleDeviceConnected}
              onSkipConnection={handleSkipConnection}
              onBackToDeviceList={handleBackToDeviceList}
            />
          </div>

          <Drawer
            type="overlay"
            separator
            open={isDownloadsOpen}
            onOpenChange={(_, { open }) => setIsDownloadsOpen(open)}
            position="end"
            style={{ width: '700px' }}
            mountNode={mountNodeRef.current}
          >
            <DrawerHeader>
              <DrawerHeaderTitle
                action={
                  <Button
                    appearance="subtle"
                    aria-label="Close"
                    icon={<CloseIcon />}
                    onClick={() => setIsDownloadsOpen(false)}
                  />
                }
              >
                Downloads
              </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody>
              <div>
                <DownloadsView />
              </div>
            </DrawerBody>
          </Drawer>
        </div>
        <div
          id="portal-parent"
          style={{
            zIndex: 1000,
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none'
          }}
        >
          <div ref={mountNodeRef} id="portal" style={{ pointerEvents: 'auto' }}></div>
        </div>
      </DependencyProvider>
    </FluentProvider>
  )
}

const AppLayoutWithProviders: React.FC = () => {
  return (
    <DownloadProvider>
      <AppLayout />
    </DownloadProvider>
  )
}

export default AppLayoutWithProviders
