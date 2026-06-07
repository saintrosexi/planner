const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Database API
  database: {
    get: () => ipcRenderer.invoke('db-get'),
    save: (data) => ipcRenderer.invoke('db-save', data),
    export: (destPath) => ipcRenderer.invoke('db-export', destPath),
    import: (srcPath) => ipcRenderer.invoke('db-import', srcPath),
    getPath: () => ipcRenderer.invoke('db-get-path')
  },
  
  // Settings API
  settings: {
    updateGlobalShortcut: (shortcut) => ipcRenderer.invoke('settings-update-shortcut', shortcut),
    setAutoLaunch: (enable) => ipcRenderer.invoke('settings-set-autolaunch', enable),
    getLocalServerAddress: () => ipcRenderer.invoke('get-local-server-address')
  },
  
  // System Utility API
  system: {
    minimize: () => ipcRenderer.send('window-minimize'),
    close: () => ipcRenderer.send('window-close'), // actually minimizes to tray
    selectExportPath: () => ipcRenderer.invoke('dialog-select-export'),
    selectImportPath: () => ipcRenderer.invoke('dialog-select-import'),
    writeToClipboard: (text) => ipcRenderer.invoke('system-write-clipboard', text),
    openExternal: (url) => ipcRenderer.invoke('system-open-external', url)
  },

  // Global events
  events: {
    onShortcutPressed: (callback) => {
      const listener = (event, text) => callback(text);
      ipcRenderer.on('global-shortcut-triggered', listener);
      return () => ipcRenderer.off('global-shortcut-triggered', listener);
    },
    onWindowFocused: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('window-focused', listener);
      return () => ipcRenderer.off('window-focused', listener);
    },
    onDbUpdatedExternally: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('db-updated-externally', listener);
      return () => ipcRenderer.off('db-updated-externally', listener);
    }
  }
});
