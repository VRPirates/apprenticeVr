import { app, shell, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import adbService from './services/adbService'
import gameService from './services/gameService'

let mainWindow: BrowserWindow | null = null

// Initialize services
async function initializeServices(): Promise<void> {
  try {
    // Initialize gameService
    await gameService.initialize()
  } catch (error) {
    console.error('Error initializing services:', error)
  }
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false // Allow loading local resources (thumbnails)
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Setup file protocol handler for local resources
  protocol.registerFileProtocol('file', (request, callback) => {
    const pathname = decodeURI(request.url.replace('file:///', ''))
    callback(pathname)
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // --------- IPC Handlers --------- //

  // --- ADB Handlers ---
  ipcMain.handle('list-devices', async () => {
    return await adbService.listDevices()
  })

  ipcMain.handle('connect-device', async (_event, serial: string) => {
    return await adbService.connectToDevice(serial)
  })

  ipcMain.handle('get-installed-packages', async (_event, serial: string) => {
    return await adbService.getInstalledPackages(serial)
  })

  // NEW: Handle getPackageVersionCode
  ipcMain.handle(
    'adb:getPackageVersionCode',
    async (_event, serial: string, packageName: string) => {
      console.log(`IPC adb:getPackageVersionCode called for ${packageName} on ${serial}`) // Added log
      return await adbService.getPackageVersionCode(serial, packageName)
    }
  )

  ipcMain.on('start-tracking-devices', () => {
    // Check if mainWindow exists before passing
    if (mainWindow) {
      adbService.startTrackingDevices(mainWindow)
    } else {
      console.error('Cannot start tracking devices, mainWindow is not available.')
    }
  })

  ipcMain.on('stop-tracking-devices', () => {
    adbService.stopTrackingDevices()
  })

  // --- Game Handlers ---
  ipcMain.handle('get-games', async () => {
    return gameService.getGames()
  })

  ipcMain.handle('get-last-sync-time', async () => {
    return gameService.getLastSyncTime()
  })

  ipcMain.handle('force-sync-games', async () => {
    await gameService.forceSync()
    // Send progress updates back to renderer during sync if needed here
    return gameService.getGames()
  })

  // Create window
  createWindow()

  // Initialize services
  await initializeServices()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  adbService.stopTrackingDevices() // Stop tracking when app quits
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up ADB tracking when app is quitting
app.on('will-quit', () => {
  adbService.stopTrackingDevices()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
