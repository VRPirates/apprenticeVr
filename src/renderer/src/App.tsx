import AppLayout from './components/AppLayout'
import './assets/device-list.css'
import './assets/games-view.css'
import './assets/app.css'

function App(): React.JSX.Element {
  return (
    <div className="app-container">
      <AppLayout />
    </div>
  )
}

export default App
