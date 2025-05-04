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
  // teamsDarkTheme,
  teamsLightTheme as theTheme
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
    gap: tokens.spacingHorizontalM
  },
  logo: {
    height: '32px'
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
    // Show progress if available
    let progressText = 'Checking requirements...'
    if (dependencyProgress) {
      progressText = `Setting up ${dependencyProgress.name}... ${dependencyProgress.percentage}%`
      if (dependencyProgress.name.endsWith('-extract')) {
        progressText = `Extracting ${dependencyProgress.name.replace('-extract', '')}...`
      }
    }
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

  const currentTheme = theTheme

  return (
    <FluentProvider theme={currentTheme}>
      <DependencyProvider>
        <div className={styles.root}>
          <div className={styles.header}>
            <img alt="logo" className={styles.logo} src={electronLogo} />
            <Title1>Apprentice VR</Title1>
          </div>
          <div className={styles.mainContent}>
            <MainContent
              currentView={currentView}
              onDeviceConnected={handleDeviceConnected}
              onSkipConnection={handleSkipConnection}
              onBackToDeviceList={handleBackToDeviceList}
            />
          </div>
        </div>
      </DependencyProvider>
    </FluentProvider>
  )
}

export default AppLayout
