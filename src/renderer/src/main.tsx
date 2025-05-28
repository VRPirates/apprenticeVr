import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/index.css'
import log from 'electron-log/renderer'

Object.assign(console, log.functions)
log.errorHandler.startCatching()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
