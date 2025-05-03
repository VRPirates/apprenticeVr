import React, { useState } from 'react'
import { AdbProvider } from '../context/AdbProvider'
import { GamesProvider } from '../context/GamesProvider'
import DeviceList from './DeviceList'
import GamesView from './GamesView'
import electronLogo from '../assets/electron.svg'

enum AppView {
  DEVICE_LIST,
  GAMES
}

const AppLayout: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.DEVICE_LIST)

  const handleDeviceConnected = (): void => {
    setCurrentView(AppView.GAMES)
  }

  const handleSkipConnection = (): void => {
    setCurrentView(AppView.GAMES)
  }

  const handleBackToDeviceList = (): void => {
    setCurrentView(AppView.DEVICE_LIST)
  }

  return (
    <AdbProvider>
      <GamesProvider>
        <div className="app-content">
          <div className="app-header">
            <img alt="logo" className="logo" src={electronLogo} />
            <h1>Apprentice VR - Meta Quest ADB Manager</h1>
          </div>

          <div className="app-main">
            {currentView === AppView.DEVICE_LIST ? (
              <DeviceList onConnected={handleDeviceConnected} onSkip={handleSkipConnection} />
            ) : (
              <GamesView onBackToDevices={handleBackToDeviceList} />
            )}
          </div>
        </div>
      </GamesProvider>
    </AdbProvider>
  )
}

export default AppLayout
