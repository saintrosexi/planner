const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, dialog, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database');

let mainWindow = null;
let tray = null;
let currentShortcut = 'Alt+Shift+T';

function telRequest(token, method, payload = null) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const options = {
      method: payload ? 'POST' : 'GET',
      headers: {}
    };
    if (payload) {
      options.headers['Content-Type'] = 'application/json';
    }
    
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    if (payload) {
      req.write(JSON.stringify(payload));
    }
    req.end();
  });
}

function downloadDbFromTelegram(token, chatId) {
  const https = require('https');
  return new Promise(async (resolve) => {
    try {
      const chatInfo = await telRequest(token, 'getChat', { chat_id: chatId });
      if (!chatInfo.ok) return resolve(null);
      
      const pinned = chatInfo.result.pinned_message;
      if (!pinned || !pinned.document || pinned.document.file_name !== 'db.json') {
        return resolve(null);
      }
      
      const fileInfo = await telRequest(token, 'getFile', { file_id: pinned.document.file_id });
      if (!fileInfo.ok) return resolve(null);
      
      const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
      https.get(downloadUrl, (fileRes) => {
        let fileData = '';
        fileRes.on('data', chunk => { fileData += chunk; });
        fileRes.on('end', () => {
          try {
            resolve(JSON.parse(fileData));
          } catch (e) {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

function uploadDbToTelegram(token, chatId, data) {
  const https = require('https');
  return new Promise((resolve) => {
    try {
      const dbContent = JSON.stringify(data, null, 2);
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      
      const payloadHeader = 
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
        `${chatId}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="document"; filename="db.json"\r\n` +
        `Content-Type: application/json\r\n\r\n`;
      
      const payloadFooter = `\r\n--${boundary}--`;
      
      const headerBuffer = Buffer.from(payloadHeader, 'utf-8');
      const contentBuffer = Buffer.from(dbContent, 'utf-8');
      const footerBuffer = Buffer.from(payloadFooter, 'utf-8');
      
      const totalPayload = Buffer.concat([headerBuffer, contentBuffer, footerBuffer]);
      
      const sendUrl = `https://api.telegram.org/bot${token}/sendDocument`;
      const reqOptions = {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': totalPayload.length
        }
      };
      
      const tReq = https.request(sendUrl, reqOptions, (tRes) => {
        let responseData = '';
        tRes.on('data', chunk => { responseData += chunk; });
        tRes.on('end', async () => {
          try {
            const resData = JSON.parse(responseData);
            if (resData.ok) {
              const messageId = resData.result.message_id;
              await telRequest(token, 'pinChatMessage', {
                chat_id: chatId,
                message_id: messageId,
                disable_notification: true
              });
            }
            resolve(true);
          } catch (e) {
            resolve(false);
          }
        });
      });
      
      tReq.on('error', () => resolve(false));
      tReq.write(totalPayload);
      tReq.end();
    } catch (e) {
      resolve(false);
    }
  });
}


function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = nativeImage.createFromBuffer(Buffer.from(trayIconBase64, 'base64'));
  }
  tray = new Tray(icon);
  tray.setToolTip('Task & CRM Planner');
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Открыть Planner', click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          
          mainWindow.setAlwaysOnTop(true);
          mainWindow.setAlwaysOnTop(false);
          
          setTimeout(() => {
            if (mainWindow) {
              mainWindow.focus();
              mainWindow.webContents.focus();
              mainWindow.webContents.send('window-focused');
            }
          }, 100);
        }
      } 
    },
    { type: 'separator' },
    { label: 'Выход', click: () => {
        app.isQuitting = true;
        app.quit();
      } 
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
        
        setTimeout(() => {
          if (mainWindow) {
            mainWindow.focus();
            mainWindow.webContents.focus();
            mainWindow.webContents.send('window-focused');
          }
        }, 100);
      }
    }
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.ico');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = nativeImage.createFromBuffer(Buffer.from(trayIconBase64, 'base64'));
  }
  mainWindow = new BrowserWindow({
    width: 1706,   // Launch size: 16:9 aspect ratio (960p)
    height: 960,
    minWidth: 800,
    minHeight: 550,
    frame: false, // Frameless for custom header overlay
    transparent: false,
    backgroundColor: '#0c0d12', // Matches our dark CSS theme exactly
    show: false,
    icon: icon, // Sets the application taskbar icon
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    // Check if started via autostart hidden
    const isHidden = process.argv.includes('--hidden');
    if (!isHidden) {
      mainWindow.show();
    }
  });

  // Notify renderer when window gets focus to restore cursor state
  mainWindow.on('focus', () => {
    mainWindow.webContents.send('window-focused');
  });

  // Intercept close events to minimize to tray
  mainWindow.on('close', (event) => {
    const data = db.loadDatabase();
    const hideToTray = data.settings.system.hideToTray !== false;
    if (!app.isQuitting && hideToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Global Shortcuts
function registerGlobalShortcut(shortcut) {
  globalShortcut.unregisterAll();
  currentShortcut = shortcut;
  
  try {
    const registered = globalShortcut.register(shortcut, () => {
      if (mainWindow) {
        // Restore if minimized, show, and focus
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        
        // Windows focus stealing workaround
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
        
        // Timeout to ensure OS window activation is completed
        setTimeout(() => {
          if (mainWindow) {
            mainWindow.focus();
            mainWindow.webContents.focus();
            mainWindow.webContents.send('window-focused');
          }
        }, 100);
        
        // Read clipboard and send to renderer
        const text = clipboard.readText();
        mainWindow.webContents.send('global-shortcut-triggered', text);
      }
    });
    if (!registered) {
      console.error(`Failed to register global shortcut: ${shortcut}`);
    }
  } catch (e) {
    console.error('Error registering global shortcut:', e);
  }
}

// App Event Listeners
app.whenReady().then(() => {
  createTray();
  createWindow();
  
  // Load settings and init shortcuts
  const data = db.loadDatabase();
  const shortcut = data.settings.keybindings.globalShortcut || 'Alt+Shift+T';
  registerGlobalShortcut(shortcut);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// IPC Main Handlers
ipcMain.handle('db-get', async () => {
  const localData = db.loadDatabase();
  const tg = localData.settings.telegram;
  if (tg && tg.isLinked && tg.token && tg.chatId && tg.allowBotDbAccess !== false) {
    try {
      const tgData = await downloadDbFromTelegram(tg.token, tg.chatId);
      if (tgData && tgData.updatedAt > (localData.updatedAt || 0)) {
        console.log('Telegram database is newer, updating local db.json');
        db.saveDatabase(tgData);
        return tgData;
      }
    } catch (e) {
      console.error('Error syncing database from Telegram on startup:', e);
    }
  }
  return localData;
});

ipcMain.handle('db-save', async (event, data) => {
  data.updatedAt = Date.now(); // Conflict resolution timestamp
  const success = db.saveDatabase(data);
  if (success) {
    const tg = data.settings.telegram;
    if (tg && tg.isLinked && tg.token && tg.chatId && tg.allowBotDbAccess !== false) {
      uploadDbToTelegram(tg.token, tg.chatId, data).catch(err => {
        console.error('Failed to upload db.json to Telegram in background:', err);
      });
    }
  }
  return success;
});

ipcMain.handle('db-export', async (event, destPath) => {
  return db.exportDatabase(destPath);
});

ipcMain.handle('db-import', async (event, srcPath) => {
  const result = db.importDatabase(srcPath);
  if (result.success && mainWindow) {
    // Reload shortcuts if they changed
    const shortcut = result.data.settings.keybindings.globalShortcut || 'Alt+Shift+T';
    registerGlobalShortcut(shortcut);
  }
  return result;
});

ipcMain.handle('db-get-path', () => {
  return db.getDbPath();
});

ipcMain.handle('settings-update-shortcut', (event, shortcut) => {
  registerGlobalShortcut(shortcut);
  return true;
});

ipcMain.handle('settings-set-autolaunch', (event, enable) => {
  const { exec } = require('child_process');
  
  let installedPath = '';
  if (process.env.LOCALAPPDATA) {
    installedPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'task-crm-planner', 'TaskCRMPlanner.exe');
  }
  
  const hasInstalled = installedPath && fs.existsSync(installedPath);
  const runPath = hasInstalled ? installedPath : process.execPath;
  
  if (process.platform === 'win32') {
    if (enable) {
      const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "electron.app.TaskCRMPlanner" /t REG_SZ /d "\\"${runPath}\\" --hidden" /f`;
      exec(cmd, (err) => {
        if (err) console.error('Failed to set autostart registry:', err);
      });
    } else {
      const cmd = `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "electron.app.TaskCRMPlanner" /f`;
      exec(cmd, (err) => {
        if (err) console.error('Failed to delete autostart registry:', err);
      });
    }
  } else {
    app.setLoginItemSettings({
      openAtLogin: enable,
      path: runPath,
      args: ['--hidden']
    });
  }
  return true;
});


// System Utility Handlers
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('dialog-select-export', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Экспорт резервной копии БД',
    defaultPath: path.join(app.getPath('downloads'), 'planner_backup.json'),
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  return result.filePath;
});

ipcMain.handle('dialog-select-import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Импорт резервной копии БД',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile']
  });
  return result.filePaths[0];
});

ipcMain.handle('system-write-clipboard', (event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('system-open-external', async (event, url) => {
  const { shell } = require('electron');
  await shell.openExternal(url);
  return true;
});
