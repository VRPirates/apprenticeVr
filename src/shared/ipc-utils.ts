import { ipcRenderer, IpcRendererEvent, ipcMain } from 'electron'
import { IPCChannels, IPCSendChannels, IPCEvents } from './types/ipc'

// Registry to track registered handlers
class IPCHandlerRegistry {
  private invokeHandlers = new Set<keyof IPCChannels>()
  private sendHandlers = new Set<keyof IPCSendChannels>()

  registerInvokeHandler<K extends keyof IPCChannels>(channel: K): void {
    this.invokeHandlers.add(channel)
  }

  registerSendHandler<K extends keyof IPCSendChannels>(channel: K): void {
    this.sendHandlers.add(channel)
  }

  validateAllHandled(): boolean {
    const allChannels = Object.keys(
      {} as { [K in keyof IPCChannels]: never }
    ) as (keyof IPCChannels)[]

    const missingChannels = allChannels.filter((channel) => !this.invokeHandlers.has(channel))

    if (missingChannels.length > 0) {
      console.error('Missing IPC channel handlers:', missingChannels)
      return false
    }

    return true
  }

  getRegisteredInvokeHandlers(): Set<keyof IPCChannels> {
    return new Set(this.invokeHandlers)
  }

  getRegisteredSendHandlers(): Set<keyof IPCSendChannels> {
    return new Set(this.sendHandlers)
  }
}

// Create singleton registries for main and renderer processes
export const mainRegistry = new IPCHandlerRegistry()
export const rendererRegistry = new IPCHandlerRegistry()

// Type-safe wrappers for renderer process (preload)
export const typedIpcRenderer = {
  // Type-safe invoke (with response)
  invoke: <K extends keyof IPCChannels>(
    channel: K,
    ...args: IPCChannels[K]['params']
  ): Promise<IPCChannels[K]['returns']> => {
    rendererRegistry.registerInvokeHandler(channel)
    return ipcRenderer.invoke(channel, ...args)
  },

  // Type-safe send (no response)
  send: <K extends keyof IPCSendChannels>(
    channel: K,
    ...args: IPCSendChannels[K] extends void ? [] : [IPCSendChannels[K]]
  ): void => {
    rendererRegistry.registerSendHandler(channel)
    ipcRenderer.send(channel, ...args)
  },

  // Type-safe event listeners
  on: <K extends keyof IPCEvents>(
    channel: K,
    listener: (event: IpcRendererEvent, ...args: IPCEvents[K]) => void
  ): void => {
    ipcRenderer.on(channel, listener)
  },

  removeListener: <K extends keyof IPCEvents>(
    channel: K,
    listener: (event: IpcRendererEvent, ...args: IPCEvents[K]) => void
  ): void => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// Type-safe wrappers for main process
export const typedIpcMain = {
  // Type-safe handler registration
  handle: <K extends keyof IPCChannels>(
    channel: K,
    handler: (
      event: Electron.IpcMainInvokeEvent,
      ...args: IPCChannels[K]['params']
    ) => Promise<IPCChannels[K]['returns']> | IPCChannels[K]['returns']
  ): void => {
    mainRegistry.registerInvokeHandler(channel)
    ipcMain.handle(channel, handler)
  },

  // Type-safe event handler registration
  on: <K extends keyof IPCSendChannels>(
    channel: K,
    listener: (
      event: Electron.IpcMainEvent,
      ...args: IPCSendChannels[K] extends void ? [] : [IPCSendChannels[K]]
    ) => void
  ): void => {
    mainRegistry.registerSendHandler(channel)
    ipcMain.on(channel, listener)
  },

  // Validate that all defined channels have handlers registered
  validateAllHandlersRegistered(): boolean {
    return mainRegistry.validateAllHandled()
  }
}
