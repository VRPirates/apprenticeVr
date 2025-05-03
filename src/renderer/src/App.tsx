import Versions from './components/Versions'
import DeviceList from './components/DeviceList'
import electronLogo from './assets/electron.svg'
import './assets/device-list.css'
import './assets/app.css'

function App(): React.JSX.Element {
  return (
    <>
      <div className="app-header">
        <img alt="logo" className="logo" src={electronLogo} />
        <h1>Apprentice VR - Meta Quest ADB Manager</h1>
      </div>

      <DeviceList />

      <div className="info-section">
        <p>
          This application helps you connect to your Meta Quest device via ADB. Make sure your
          device has developer mode enabled and is connected to your computer.
        </p>
      </div>

      <Versions />
    </>
  )
}

export default App
