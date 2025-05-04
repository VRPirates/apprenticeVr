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
  // teamsDarkTheme,
  teamsLightTheme as theTheme
} from '@fluentui/react-components'
import electronLogo from '../assets/electron.svg'

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
  }
})

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
      <AdbProvider>
        <GamesProvider>
          <div className={styles.root}>
            <div className={styles.header}>
              <img alt="logo" className={styles.logo} src={electronLogo} />
              <Title1>Apprentice VR</Title1>
            </div>

            <div className={styles.mainContent}>
              {currentView === AppView.DEVICE_LIST ? (
                <DeviceList onConnected={handleDeviceConnected} onSkip={handleSkipConnection} />
              ) : (
                <GamesView onBackToDevices={handleBackToDeviceList} />
              )}
            </div>
          </div>
        </GamesProvider>
      </AdbProvider>
    </FluentProvider>
  )
}

export default AppLayout
