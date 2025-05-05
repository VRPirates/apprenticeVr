import React, { useState } from 'react'
import { AdbProvider } from '../context/AdbProvider'
import { GamesProvider } from '../context/GamesProvider'
import DeviceList from './DeviceList'
import GamesView from './GamesView'
import {
  FluentProvider,
  Title1,
  makeStyles,
  tokens,
  Spinner,
  Text,
  teamsDarkTheme,
  teamsLightTheme,
  Switch
} from '@fluentui/react-components'
import electronLogo from '../assets/electron.svg'
import { useDependency } from '../hooks/useDependency'
import { DependencyProvider } from '../context/DependencyProvider'

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
    height: '32px'
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
    if (dependencyStatus?.rclone.downloading && dependencyProgress) {
      // Show specific rclone progress only if it's downloading
      progressText = `Setting up ${dependencyProgress.name}... ${dependencyProgress.percentage}%`
      if (dependencyProgress.name === 'rclone-extract') {
        progressText = `Extracting ${dependencyProgress.name.replace('-extract', '')}...`
      }
    } else if (
      dependencyStatus &&
      (!dependencyStatus.sevenZip.ready || !dependencyStatus.rclone.ready)
    ) {
      // Generic checking message if not downloading but still not ready
      progressText = 'Checking required tools...'
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
      <GamesProvider>
        {currentView === AppView.DEVICE_LIST ? (
          <DeviceList onConnected={onDeviceConnected} onSkip={onSkipConnection} />
        ) : (
          <GamesView onBackToDevices={onBackToDeviceList} />
        )}
      </GamesProvider>
    </AdbProvider>
  )
}

const AppLayout: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.DEVICE_LIST)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const styles = useStyles()

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

  return (
    <FluentProvider theme={currentTheme}>
      <DependencyProvider>
        <div className={styles.root}>
          <div className={styles.header}>
            <div className={styles.headerContent}>
              <img alt="logo" className={styles.logo} src={electronLogo} />
              <Title1>Apprentice VR</Title1>
            </div>
            <Switch
              label={isDarkMode ? 'Dark mode' : 'Light mode'}
              checked={isDarkMode}
              onChange={handleThemeChange}
            />
          </div>
          <div id="mainContent">
            <MainContent
              currentView={currentView}
              onDeviceConnected={handleDeviceConnected}
              onSkipConnection={handleSkipConnection}
              onBackToDeviceList={handleBackToDeviceList}
            />
          </div>
        </div>
        <div
          id="portal"
          style={{
            zIndex: 1000,
            position: 'fixed'
          }}
        ></div>
      </DependencyProvider>
    </FluentProvider>
  )
}

export default AppLayout
