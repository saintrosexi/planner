const isWebApp = typeof window.api === 'undefined';
if (isWebApp) {
  window.api = {
    database: {
      get: async () => {
        const token = localStorage.getItem('tg_bot_token');
        const chatId = localStorage.getItem('tg_chat_id');
        if (!token || !chatId) {
          return getDefaultDbTemplate();
        }
        try {
          const res = await fetch('/api/db', {
            headers: {
              'X-Telegram-Bot-Token': token,
              'X-Telegram-Chat-Id': chatId
            }
          });
          const data = await res.json();
          if (data.isNew) {
            return getDefaultDbTemplate();
          }
          return data;
        } catch (e) {
          console.error('Failed to load database from Vercel/Telegram:', e);
          return getDefaultDbTemplate();
        }
      },
      save: async (data) => {
        const token = localStorage.getItem('tg_bot_token');
        const chatId = localStorage.getItem('tg_chat_id');
        if (!token || !chatId) return false;
        
        data.updatedAt = Date.now(); // conflict resolution
        try {
          const res = await fetch('/api/db', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Telegram-Bot-Token': token,
              'X-Telegram-Chat-Id': chatId
            },
            body: JSON.stringify(data)
          });
          return res.json();
        } catch (e) {
          console.error('Failed to save database to Vercel/Telegram:', e);
          return false;
        }
      },
      export: async () => ({ success: false, error: 'Экспорт не поддерживается в веб-версии.' }),
      import: async () => ({ success: false, error: 'Импорт не поддерживается в веб-версии.' }),
      getPath: async () => 'Telegram Cloud Database (db.json)'
    },
    settings: {
      updateGlobalShortcut: async () => false,
      setAutoLaunch: async () => false,
      getLocalServerAddress: async () => ''
    },
    system: {
      minimize: () => {},
      close: () => {},
      selectExportPath: async () => null,
      selectImportPath: async () => null,
      writeToClipboard: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (e) {
          console.error('Clipboard write failed:', e);
          return false;
        }
      },
      openExternal: async (url) => {
        window.open(url, '_blank');
        return true;
      }
    },
    events: {
      onShortcutPressed: () => () => {},
      onWindowFocused: () => () => {}
    }
  };
}

function getDefaultDbTemplate() {
  return {
    folders: [],
    items: [],
    tags: [],
    outcomes: [],
    settings: {
      keybindings: {
        newline: 'Shift+Enter',
        save: 'Ctrl+Enter',
        globalShortcut: 'Alt+Shift+T'
      },
      telegram: {
        token: '',
        chatId: '',
        username: '',
        isLinked: false,
        allowBotDbAccess: true,
        tgMorningTime: '09:00',
        tgEveningTime: '21:00',
        lastMorningNotifDate: '',
        lastEveningNotifDate: '',
        sentTgReminders: [],
        lastUpdateId: 0
      },
      system: {
        runOnStartup: false,
        hideToTray: true
      }
    }
  };
}

// State Variables
let dbData = null;
let activeView = 'editor';
let activeFolderId = '';
let tempItem = null;
let selectedTags = [];
let lastFocusedInput = null;
let editingFolderId = null;

// Telegram Client Polling State
let isMessagePollingActive = false;
let messagePollOffset = 0;
let isHandshakePollingActive = false;
let handshakePollOffset = 0;
let currentHandshakeSessionId = 0;
let schedulerInterval = null;

// Predefined colors for Folders and Tags
const PRESET_COLORS = [
  '#3b82f6', // Blue
  '#f97316', // Orange
  '#10b981', // Green
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#ef4444', // Red
  '#eab308', // Yellow
  '#6b7280'  // Gray
];

// DOM Elements cache
const el = {
  // Titlebar
  btnMinimize: document.getElementById('btn-minimize'),
  btnClose: document.getElementById('btn-close'),
  
  // Navigation
  navEditor: document.getElementById('nav-editor'),
  navProfile: document.getElementById('nav-profile'),
  navSettings: document.getElementById('nav-settings'),
  foldersList: document.getElementById('folders-list'),
  btnAddFolder: document.getElementById('btn-add-folder'),
  
  // Views
  viewEditor: document.getElementById('view-editor'),
  viewFolder: document.getElementById('view-folder'),
  viewProfile: document.getElementById('view-profile'),
  viewSettings: document.getElementById('view-settings'),
  
  // Editor
  editorTitle: document.getElementById('editor-title'),
  editorDescription: document.getElementById('editor-description'),
  badgeNewline: document.getElementById('badge-newline'),
  todayTasksList: document.getElementById('today-tasks-list'),
  
  // Folder View
  folderViewIcon: document.getElementById('folder-view-icon'),
  folderViewName: document.getElementById('folder-view-name'),
  btnDeleteFolder: document.getElementById('btn-delete-folder'),
  statTotal: document.getElementById('stat-total'),
  statToday: document.getElementById('stat-today'),
  statTomorrow: document.getElementById('stat-tomorrow'),
  folderItemsList: document.getElementById('folder-items-list'),
  
  // Telegram Profile
  tgDisconnectedSection: document.getElementById('tg-disconnected-section'),
  tgConnectedSection: document.getElementById('tg-connected-section'),
  tgTokenInput: document.getElementById('tg-token-input'),
  btnTgConnect: document.getElementById('btn-tg-connect'),
  tgAuthCodeBox: document.getElementById('tg-auth-code-box'),
  tgAuthCode: document.getElementById('tg-auth-code'),
  tgDeepLink: document.getElementById('tg-deep-link'),
  tgLinkedChatId: document.getElementById('tg-linked-chat-id'),
  tgLinkedUsername: document.getElementById('tg-linked-username'),
  tgMorningTime: document.getElementById('tg-morning-time'),
  tgEveningTime: document.getElementById('tg-evening-time'),
  chkTgDbAccess: document.getElementById('chk-tg-db-access'),
  btnTgTest: document.getElementById('btn-tg-test'),
  btnTgUnlink: document.getElementById('btn-tg-unlink'),
  
  // Settings
  tagsManagerList: document.getElementById('tags-manager-list'),
  btnAddTag: document.getElementById('btn-add-tag'),
  outcomesManagerList: document.getElementById('outcomes-manager-list'),
  btnAddOutcome: document.getElementById('btn-add-outcome'),
  bindNewline: document.getElementById('bind-newline'),
  bindSave: document.getElementById('bind-save'),
  bindGlobal: document.getElementById('bind-global'),
  btnSaveNewline: document.getElementById('btn-save-newline'),
  btnSaveSave: document.getElementById('btn-save-save'),
  btnSaveGlobalShortcut: document.getElementById('btn-save-global-shortcut'),
  chkAutostart: document.getElementById('chk-autostart'),
  chkHideToTray: document.getElementById('chk-hide-to-tray'),
  dbPathText: document.getElementById('db-path-text'),
  btnExportDb: document.getElementById('btn-export-db'),
  btnImportDb: document.getElementById('btn-import-db'),
  
  // Mobile / Web UI
  mobileMenuBtn: document.getElementById('btn-mobile-menu'),
  sidebarOverlay: document.getElementById('sidebar-overlay'),
  btnDownloadDesktop: document.getElementById('btn-download-desktop'),
  webQrImg: document.getElementById('web-qr-img'),
  webServerLink: document.getElementById('web-server-link'),
  cardWebAccess: document.getElementById('card-web-access'),
  
  // Web Login DOM elements
  webLoginOverlay: document.getElementById('web-login-overlay'),
  btnLoginMethodCode: document.getElementById('btn-method-code'),
  btnLoginMethodManual: document.getElementById('btn-method-manual'),
  loginTokenInput: document.getElementById('login-token-input'),
  loginMethodCodePanel: document.getElementById('login-method-code-panel'),
  btnLoginGetCode: document.getElementById('btn-login-get-code'),
  loginCodeDisplayBox: document.getElementById('login-code-display-box'),
  loginAuthCode: document.getElementById('login-auth-code'),
  loginDeepLink: document.getElementById('login-deep-link'),
  loginPollingSpinner: document.getElementById('login-polling-spinner'),
  loginMethodManualPanel: document.getElementById('login-method-manual-panel'),
  loginChatIdInput: document.getElementById('login-chatid-input'),
  btnLoginManualSubmit: document.getElementById('btn-login-manual-submit'),
  
  // Detail Modal
  modalDetail: document.getElementById('modal-detail'),
  modalClose: document.getElementById('modal-close'),
  modalTitleInput: document.getElementById('modal-title-input'),
  modalDescInput: document.getElementById('modal-desc-input'),
  modalFolderChips: document.getElementById('modal-folder-chips'),
  modalDatetimeInput: document.getElementById('modal-datetime-input'),
  modalTagsContainer: document.getElementById('modal-tags-container'),
  modalTypeHint: document.getElementById('modal-type-hint'),
  modalCancelBtn: document.getElementById('modal-cancel-btn'),
  modalSaveBtn: document.getElementById('modal-save-btn'),
  btnDateClear: document.getElementById('btn-date-clear'),
  
  // Folder Modal
  modalFolder: document.getElementById('modal-folder'),
  modalFolderClose: document.getElementById('modal-folder-close'),
  folderNameInput: document.getElementById('folder-name-input'),
  folderColorPalette: document.getElementById('folder-color-palette'),
  folderIconInput: document.getElementById('folder-icon-input'),
  btnEmojiPicker: document.getElementById('btn-emoji-picker'),
  emojiPickerPopup: document.getElementById('emoji-picker-popup'),
  customEmojiInput: document.getElementById('custom-emoji-input'),
  modalFolderCancel: document.getElementById('modal-folder-cancel'),
  modalFolderSave: document.getElementById('modal-folder-save'),
  
  // Tag Modal
  modalTagCreate: document.getElementById('modal-tag-create'),
  modalTagClose: document.getElementById('modal-tag-close'),
  tagModalTitle: document.getElementById('tag-modal-title'),
  tagEditId: document.getElementById('tag-edit-id'),
  tagNameInput: document.getElementById('tag-name-input'),
  tagColorPalette: document.getElementById('tag-color-palette'),
  modalTagCancel: document.getElementById('modal-tag-cancel'),
  modalTagSave: document.getElementById('modal-tag-save'),
  
  // Outcome Modal
  modalOutcome: document.getElementById('modal-outcome'),
  modalOutcomeClose: document.getElementById('modal-outcome-close'),
  outcomeModalTitle: document.getElementById('outcome-modal-title'),
  outcomeEditId: document.getElementById('outcome-edit-id'),
  outcomeNameInput: document.getElementById('outcome-name-input'),
  outcomeColorPalette: document.getElementById('outcome-color-palette'),
  modalOutcomeCancel: document.getElementById('modal-outcome-cancel'),
  modalOutcomeSave: document.getElementById('modal-outcome-save'),
  
  // Quick Outcome Modal
  modalQuickOutcome: document.getElementById('modal-quick-outcome'),
  modalQuickOutcomeClose: document.getElementById('modal-quick-outcome-close'),
  quickOutcomeItemId: document.getElementById('quick-outcome-item-id'),
  quickOutcomeList: document.getElementById('quick-outcome-list'),
  btnQuickOutcomeClear: document.getElementById('btn-quick-outcome-clear'),
  
  // Quick Folder Modal (for quick save)
  modalQuickFolder: document.getElementById('modal-quick-folder'),
  modalQuickFolderClose: document.getElementById('modal-quick-folder-close'),
  quickFolderList: document.getElementById('quick-folder-list'),

  // Custom Confirmation Modal
  modalConfirm: document.getElementById('modal-confirm'),
  modalConfirmClose: document.getElementById('modal-confirm-close'),
  confirmModalTitle: document.getElementById('confirm-modal-title'),
  confirmModalMessage: document.getElementById('confirm-modal-message'),
  btnConfirmCancel: document.getElementById('modal-confirm-cancel'),
  btnConfirmOk: document.getElementById('modal-confirm-ok'),

  // Custom Context Menu
  customContextMenu: document.getElementById('custom-context-menu'),
  contextMenuList: document.getElementById('context-menu-list'),

  // Toast
  copyToast: document.getElementById('copy-toast')
};

// --- Initial Startup ---
// --- Initial Startup ---
let loginPollingInterval = null;

function showLoginOverlay() {
  el.webLoginOverlay.style.display = 'flex';
  
  el.btnLoginMethodCode.addEventListener('click', () => {
    el.btnLoginMethodCode.className = 'primary-btn btn-sm';
    el.btnLoginMethodManual.className = 'secondary-btn btn-sm';
    el.loginMethodCodePanel.style.display = 'flex';
    el.loginMethodManualPanel.style.display = 'none';
  });
  
  el.btnLoginMethodManual.addEventListener('click', () => {
    el.btnLoginMethodCode.className = 'secondary-btn btn-sm';
    el.btnLoginMethodManual.className = 'primary-btn btn-sm';
    el.loginMethodCodePanel.style.display = 'none';
    el.loginMethodManualPanel.style.display = 'flex';
  });
  
  el.btnLoginGetCode.addEventListener('click', async () => {
    const token = el.loginTokenInput.value.trim();
    if (!token) {
      showToast('Введите токен бота!', true);
      return;
    }
    
    const loginCode = Math.floor(100000 + Math.random() * 900000).toString();
    el.loginAuthCode.textContent = loginCode;
    
    el.loginAuthCode.onclick = () => {
      navigator.clipboard.writeText(loginCode);
      showToast('Код скопирован!');
    };
    
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const botInfo = await res.json();
      if (botInfo.ok && botInfo.result.username) {
        const username = botInfo.result.username;
        el.loginDeepLink.href = `https://t.me/${username}?start=${loginCode}`;
        el.loginDeepLink.style.display = 'inline-flex';
      } else {
        el.loginDeepLink.style.display = 'none';
      }
    } catch (e) {
      el.loginDeepLink.style.display = 'none';
    }
    
    el.loginCodeDisplayBox.style.display = 'flex';
    el.btnLoginGetCode.style.display = 'none';
    
    if (loginPollingInterval) clearInterval(loginPollingInterval);
    loginPollingInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/verify?token=${encodeURIComponent(token)}&code=${loginCode}`);
        const result = await res.json();
        if (result.success && result.chatId) {
          clearInterval(loginPollingInterval);
          
          localStorage.setItem('tg_bot_token', token);
          localStorage.setItem('tg_chat_id', result.chatId.toString());
          
          showToast(`Добро пожаловать, ${result.username}!`);
          el.webLoginOverlay.style.display = 'none';
          
          await initAppSequence();
        }
      } catch (err) {
        console.error('Verify poll error:', err);
      }
    }, 2000);
  });
  
  el.btnLoginManualSubmit.addEventListener('click', async () => {
    const token = el.loginTokenInput.value.trim();
    const chatId = el.loginChatIdInput.value.trim();
    if (!token || !chatId) {
      showToast('Введите токен и ID чата!', true);
      return;
    }
    
    showToast('Проверка данных...');
    try {
      const res = await fetch(`/api/db?token=${encodeURIComponent(token)}&chatId=${encodeURIComponent(chatId)}`);
      const result = await res.json();
      if (res.status === 200) {
        localStorage.setItem('tg_bot_token', token);
        localStorage.setItem('tg_chat_id', chatId);
        
        showToast('Вход выполнен успешно!');
        el.webLoginOverlay.style.display = 'none';
        
        await initAppSequence();
      } else {
        showToast(`Ошибка входа: ${result.error || 'неверные данные'}`, true);
      }
    } catch (err) {
      showToast('Ошибка подключения к серверу', true);
    }
  });
}

async function initAppSequence() {
  await loadData();
  setupEventListeners();
  initContextMenu();
  switchView('editor');
  
  const path = await window.api.database.getPath();
  el.dbPathText.textContent = path;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (isWebApp) {
    document.body.classList.add('web-app');
    el.btnDownloadDesktop.href = 'https://github.com/saintrosexi/planner/raw/main/dist/TaskCRMPlanner%20Setup%201.0.0.exe';
    el.btnDownloadDesktop.style.display = 'flex';
    el.cardWebAccess.style.display = 'none';
    
    const systemCard = el.chkAutostart.closest('.settings-card');
    if (systemCard) systemCard.style.display = 'none';
    
    const token = localStorage.getItem('tg_bot_token');
    const chatId = localStorage.getItem('tg_chat_id');
    if (!token || !chatId) {
      showLoginOverlay();
      return;
    }
  } else {
    // Desktop Electron configuration
    const cloudUrl = 'https://saintrosexi-planner.vercel.app';
    el.webServerLink.href = cloudUrl;
    el.webServerLink.textContent = cloudUrl;
    el.webQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(cloudUrl)}`;
    
    if (window.api.events.onDbUpdatedExternally) {
      window.api.events.onDbUpdatedExternally((newData) => {
        updateUIFromExternalDB(newData);
        showToast('База данных обновлена с телефона');
      });
    }
    
    // Poll Telegram for database updates in background every 60 seconds
    setInterval(async () => {
      const tg = dbData && dbData.settings.telegram;
      if (tg && tg.isLinked && tg.token && tg.chatId && tg.allowBotDbAccess !== false) {
        try {
          const newData = await window.api.database.get();
          if (newData && newData.updatedAt > (dbData.updatedAt || 0)) {
            updateUIFromExternalDB(newData);
            showToast('База данных синхронизирована с облаком Telegram');
          }
        } catch (e) {
          console.error('Failed to sync Telegram database in background:', e);
        }
      }
    }, 60000);
  }

  // Hamburger Menu Toggling logic for mobile views
  if (el.mobileMenuBtn && el.sidebarOverlay) {
    el.mobileMenuBtn.addEventListener('click', () => {
      document.body.classList.toggle('menu-open');
    });
    
    el.sidebarOverlay.addEventListener('click', () => {
      document.body.classList.remove('menu-open');
    });
    
    document.addEventListener('click', (e) => {
      if (e.target.closest('.sidebar .nav-item') || e.target.closest('.sidebar .nav-folder-btn')) {
        document.body.classList.remove('menu-open');
      }
    });
  }

  await initAppSequence();
});

function updateUIFromExternalDB(newData) {
  dbData = newData;
  renderSidebar();
  renderTodayTasks();
  if (activeView === 'editor') {
    renderTodayTasks();
  } else if (activeView === 'folder') {
    renderFolderView(activeFolderId);
  } else if (activeView === 'profile') {
    updateTelegramUI();
  } else if (activeView === 'settings') {
    renderSettingsView();
  }
}

// Load Database Data
async function loadData() {
  dbData = await window.api.database.get();
  renderSidebar();
  renderTodayTasks();
  
  // Setup settings fields from loaded database
  el.bindNewline.value = dbData.settings.keybindings.newline || 'Shift+Enter';
  el.bindSave.value = dbData.settings.keybindings.save || 'Ctrl+Enter';
  el.badgeNewline.textContent = dbData.settings.keybindings.newline || 'Shift+Enter';
  el.bindGlobal.value = dbData.settings.keybindings.globalShortcut || 'Alt+Shift+T';
  el.chkAutostart.checked = dbData.settings.system.runOnStartup || false;
  el.chkHideToTray.checked = dbData.settings.system.hideToTray !== false;
  
  // Initialize scheduler and message polling if Telegram is linked
  const tg = dbData.settings.telegram;
  if (tg.isLinked && tg.token && tg.chatId) {
    startMessagePolling();
    startSchedulerTimer();
  } else {
    stopTelegramBackgroundServices();
  }
  
  // Update telegram interface status
  updateTelegramUI();
}

// Save Database Data
async function saveData() {
  await window.api.database.save(dbData);
  renderSidebar();
  renderTodayTasks();
  if (activeView === 'folder' && activeFolderId) {
    renderFolderView(activeFolderId);
  }
}

// --- Date Helpers ---
function getLocalDateString(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isToday(dateString) {
  if (!dateString) return false;
  const todayStr = getLocalDateString(new Date());
  const itemStr = getLocalDateString(dateString);
  return todayStr === itemStr;
}

function isTomorrow(dateString) {
  if (!dateString) return false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = getLocalDateString(tomorrow);
  const itemStr = getLocalDateString(dateString);
  return tomorrowStr === itemStr;
}

function isOverdue(dateString, completed) {
  if (!dateString || completed) return false;
  const now = new Date();
  const date = new Date(dateString);
  return date < now;
}

function formatDisplayDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  
  const timePart = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (isToday(dateString)) {
    return `Сегодня в ${timePart}`;
  } else if (isTomorrow(dateString)) {
    return `Завтра в ${timePart}`;
  }
  
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// --- View Router ---
function switchView(viewName, folderId = '') {
  activeView = viewName;
  activeFolderId = folderId;
  
  // Toggle active class on sidebar items
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  
  if (viewName === 'editor') el.navEditor.classList.add('active');
  else if (viewName === 'profile') el.navProfile.classList.add('active');
  else if (viewName === 'settings') el.navSettings.classList.add('active');
  else if (viewName === 'folder' && folderId) {
    const fBtn = document.querySelector(`.nav-folder-btn[data-id="${folderId}"]`);
    if (fBtn) fBtn.classList.add('active');
  }
  
  // Toggle view panels
  el.viewEditor.classList.remove('active');
  el.viewFolder.classList.remove('active');
  el.viewProfile.classList.remove('active');
  el.viewSettings.classList.remove('active');
  
  if (viewName === 'editor') {
    el.viewEditor.classList.add('active');
    el.editorTitle.focus();
    renderTodayTasks();
  } else if (viewName === 'folder') {
    el.viewFolder.classList.add('active');
    renderFolderView(folderId);
  } else if (viewName === 'profile') {
    el.viewProfile.classList.add('active');
    updateTelegramUI();
  } else if (viewName === 'settings') {
    el.viewSettings.classList.add('active');
    renderSettingsView();
  }
}

// --- Sidebar Render ---
function renderSidebar() {
  el.foldersList.innerHTML = '';
  
  if (dbData.folders.length === 0) {
    el.foldersList.innerHTML = '<div style="color: var(--text-dark); padding: 12px; font-size: 0.85rem; font-style: italic; text-align: center;">Нет папок. Нажмите + выше.</div>';
    return;
  }
  
  dbData.folders.forEach(folder => {
    const btn = document.createElement('button');
    btn.className = 'nav-item nav-folder-btn';
    btn.setAttribute('data-id', folder.id);
    
    // Add colored indicator line
    const indicator = document.createElement('span');
    indicator.className = 'folder-dot-indicator';
    indicator.style.backgroundColor = folder.color;
    indicator.style.width = '8px';
    indicator.style.height = '8px';
    indicator.style.borderRadius = '50%';
    indicator.style.display = 'inline-block';
    
    const icon = document.createElement('span');
    icon.className = 'nav-icon';
    icon.textContent = folder.icon || '📁';
    
    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = folder.name;
    label.style.flexGrow = '1';
    
    btn.appendChild(icon);
    btn.appendChild(label);
    btn.appendChild(indicator);
    
    btn.addEventListener('click', () => {
      switchView('folder', folder.id);
    });
    
    el.foldersList.appendChild(btn);
  });
}

// --- Copy & Toast Utility ---
let toastTimeout = null;
function showToast(message, isError = false) {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }
  el.copyToast.textContent = message;
  if (isError) {
    el.copyToast.classList.add('error');
  } else {
    el.copyToast.classList.remove('error');
  }
  el.copyToast.classList.add('active');
  toastTimeout = setTimeout(() => {
    el.copyToast.classList.remove('active');
  }, 3000);
}

function showConfirm(message, title = 'Подтверждение') {
  return new Promise((resolve) => {
    const modal = el.modalConfirm;
    const titleEl = el.confirmModalTitle;
    const msgEl = el.confirmModalMessage;
    const btnCancel = el.btnConfirmCancel;
    const btnOk = el.btnConfirmOk;
    const btnClose = el.modalConfirmClose;
    
    titleEl.textContent = title;
    msgEl.textContent = message;
    
    modal.classList.add('active');
    
    // Auto-focus Cancel button for safety
    btnCancel.focus();
    
    const cleanup = (value) => {
      modal.classList.remove('active');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      btnClose.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeyDown);
      resolve(value);
    };
    
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlayClick = (e) => {
      if (e.target === modal) {
        cleanup(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        cleanup(false);
      }
    };
    
    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
    btnClose.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeyDown);
  });
}

function copyTextToClipboard(text, cardElement) {
  window.api.system.writeToClipboard(text);
  showToast('Скопировано в буфер обмена!');
  
  // Add blink green glow border to the card
  if (cardElement) {
    cardElement.classList.add('copied-animation');
    setTimeout(() => cardElement.classList.remove('copied-animation'), 1000);
  }
}

// --- Lightweight Markdown Parser ---
function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
    
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/==(.*?)==/g, '<mark class="inline-highlight">$1</mark>');
  
  return html;
}

// --- Item Cards Rendering Helper ---
function createItemCard(item) {
  const card = document.createElement('div');
  card.className = `item-card ${item.completed ? 'completed' : ''}`;
  card.setAttribute('data-id', item.id);
  
  // Color tag indicator on the left
  const folder = dbData.folders.find(f => f.id === item.folderId);
  const color = folder ? folder.color : '#6b7280';
  
  const indicator = document.createElement('div');
  indicator.className = 'folder-indicator';
  indicator.style.backgroundColor = color;
  card.appendChild(indicator);
  
  // Checkbox (Only for Tasks)
  if (item.type === 'task') {
    const cb = document.createElement('div');
    cb.className = `checkbox-container ${item.completed ? 'checked' : ''}`;
    cb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      item.completed = !item.completed;
      saveData();
    });
    card.appendChild(cb);
  }
  
  // Content details
  const content = document.createElement('div');
  content.className = 'item-content';
  
  const titleRow = document.createElement('div');
  titleRow.className = 'item-title-row';
  
  const title = document.createElement('span');
  title.className = 'item-title';
  title.innerHTML = renderMarkdown(item.title);
  
  // Clicking title copies it
  title.addEventListener('click', (e) => {
    e.stopPropagation();
    copyTextToClipboard(item.title, card);
  });
  
  titleRow.appendChild(title);
  content.appendChild(titleRow);
  
  if (item.description) {
    const desc = document.createElement('div');
    desc.className = 'item-description';
    desc.innerHTML = renderMarkdown(item.description);
    
    // Clicking description copies it
    desc.addEventListener('click', (e) => {
      e.stopPropagation();
      copyTextToClipboard(item.description, card);
    });
    
    content.appendChild(desc);
  }
  
  // Meta tags (Time, Tags, Subtags, Outcome)
  const metaRow = document.createElement('div');
  metaRow.className = 'item-meta-row';
  
  // Scheduled Time Badge
  if (item.type === 'task' && item.dateTime) {
    const timeBadge = document.createElement('span');
    timeBadge.className = 'time-badge';
    if (isOverdue(item.dateTime, item.completed)) {
      timeBadge.classList.add('overdue');
    }
    timeBadge.innerHTML = `⏰ ${formatDisplayDate(item.dateTime)}`;
    metaRow.appendChild(timeBadge);
  } else if (item.type === 'record') {
    // Records show creation date
    const dateBadge = document.createElement('span');
    dateBadge.className = 'time-badge';
    dateBadge.innerHTML = `📝 ${formatDisplayDate(item.createdAt)}`;
    metaRow.appendChild(dateBadge);
  }
  
  // Tag Badges
  item.tags.forEach(tagId => {
    const tag = dbData.tags.find(t => t.id === tagId);
    if (tag) {
      const tagBadge = document.createElement('span');
      tagBadge.className = 'tag-badge';
      tagBadge.style.backgroundColor = tag.color + '20';
      tagBadge.style.color = tag.color;
      tagBadge.style.border = `1px solid ${tag.color}40`;
      tagBadge.textContent = tag.name;
      metaRow.appendChild(tagBadge);
    }
  });
  
  // Subtag Badges
  item.subtags.forEach(sub => {
    const subBadge = document.createElement('span');
    subBadge.className = 'subtag-badge';
    subBadge.textContent = sub;
    metaRow.appendChild(subBadge);
  });
  
  // Outcome Badge / Action (CRM feature)
  if (item.outcome) {
    const outcomeObj = dbData.outcomes.find(o => o.id === item.outcome);
    if (outcomeObj) {
      const oBadge = document.createElement('span');
      oBadge.className = 'outcome-badge';
      oBadge.style.backgroundColor = outcomeObj.color + '20';
      oBadge.style.color = outcomeObj.color;
      oBadge.style.border = `1px solid ${outcomeObj.color}40`;
      oBadge.textContent = outcomeObj.name;
      
      // Click outcome badge to change it
      oBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        openQuickOutcomeModal(item.id);
      });
      metaRow.appendChild(oBadge);
    }
  } else {
    // Button to quickly assign outcome
    const addOutcomeBtn = document.createElement('button');
    addOutcomeBtn.className = 'btn-outcome-action';
    addOutcomeBtn.textContent = '+ Исход';
    addOutcomeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openQuickOutcomeModal(item.id);
    });
    metaRow.appendChild(addOutcomeBtn);
  }
  
  content.appendChild(metaRow);
  card.appendChild(content);
  
  // Small edit button
  const editBtn = document.createElement('button');
  editBtn.className = 'action-icon-btn';
  editBtn.innerHTML = '✏️';
  editBtn.style.opacity = '0';
  editBtn.style.transition = 'opacity 0.2s';
  editBtn.style.marginLeft = '10px';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDetailModal(item);
  });
  card.appendChild(editBtn);

  // Small delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-icon-btn';
  deleteBtn.innerHTML = '🗑️';
  deleteBtn.style.opacity = '0';
  deleteBtn.style.transition = 'opacity 0.2s';
  deleteBtn.style.marginLeft = '8px';
  deleteBtn.style.color = 'var(--danger)';
  deleteBtn.title = 'Удалить';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await handleDeleteItem(item.id);
  });
  card.appendChild(deleteBtn);
  
  card.addEventListener('mouseenter', () => {
    editBtn.style.opacity = '0.7';
    deleteBtn.style.opacity = '0.7';
  });
  card.addEventListener('mouseleave', () => {
    editBtn.style.opacity = '0';
    deleteBtn.style.opacity = '0';
  });
  
  return card;
}

// --- Render Today's Tasks in Editor view ---
function renderTodayTasks() {
  el.todayTasksList.innerHTML = '';
  
  const todayTasks = dbData.items.filter(item => {
    return item.type === 'task' && !item.completed && isToday(item.dateTime);
  });
  
  if (todayTasks.length === 0) {
    el.todayTasksList.innerHTML = '<div style="color: var(--text-dark); font-style: italic; font-size: 0.9rem;">Нет запланированных задач на сегодня</div>';
    return;
  }
  
  todayTasks.forEach(task => {
    const card = createItemCard(task);
    el.todayTasksList.appendChild(card);
  });
}

// --- Render Folder Items View ---
function renderFolderView(folderId) {
  const folder = dbData.folders.find(f => f.id === folderId);
  if (!folder) {
    switchView('editor');
    return;
  }
  
  el.folderViewIcon.textContent = folder.icon || '📂';
  el.folderViewName.textContent = folder.name;
  
  // Filter items in active folder
  const folderItems = dbData.items.filter(item => item.folderId === folderId);
  
  // Calculate Statistics
  const total = folderItems.length;
  
  const today = folderItems.filter(item => {
    if (item.type === 'task') return isToday(item.dateTime);
    return isToday(item.createdAt);
  }).length;
  
  const tomorrow = folderItems.filter(item => {
    return item.type === 'task' && isTomorrow(item.dateTime);
  }).length;
  
  el.statTotal.textContent = total;
  el.statToday.textContent = today;
  el.statTomorrow.textContent = tomorrow;
  
  // Render Item Cards
  el.folderItemsList.innerHTML = '';
  if (folderItems.length === 0) {
    el.folderItemsList.innerHTML = '<div style="color: var(--text-dark); text-align: center; padding: 40px 0; font-style: italic;">Эта папка пока пуста. Введите задачу на главном экране.</div>';
    return;
  }
  
  // Sort items: incomplete tasks first, then tasks ordered by date, then records
  const sortedItems = [...folderItems].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.type !== b.type) return a.type === 'task' ? -1 : 1;
    
    // Sort tasks by date
    if (a.type === 'task') {
      if (!a.dateTime) return 1;
      if (!b.dateTime) return -1;
      return new Date(a.dateTime) - new Date(b.dateTime);
    }
    // Sort records by creation date descending
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  
  sortedItems.forEach(item => {
    const card = createItemCard(item);
    el.folderItemsList.appendChild(card);
  });
}

// --- Details Modal Actions ---
function openDetailModal(itemToEdit = null) {
  if (dbData.folders.length === 0) {
    showToast('Пожалуйста, сначала создайте папку!', true);
    openFolderCreateModal();
    return;
  }

  // Reset selected state
  selectedTags = [];
  
  if (itemToEdit) {
    // Mode: EDIT
    tempItem = { ...itemToEdit, tags: [...itemToEdit.tags], subtags: [...itemToEdit.subtags] };
    el.modalDatetimeInput.value = tempItem.dateTime ? tempItem.dateTime.substring(0, 16) : '';
  } else {
    // Mode: CREATE (From active inputs)
    const titleVal = el.editorTitle.value.trim();
    const descVal = el.editorDescription.value.trim();
    
    if (!titleVal) return;
    
    tempItem = {
      id: '',
      folderId: dbData.folders[0]?.id || '',
      type: 'record',
      title: titleVal,
      description: descVal,
      dateTime: null,
      tags: [],
      subtags: [],
      completed: false,
      outcome: null,
      createdAt: new Date().toISOString()
    };
    
    el.modalDatetimeInput.value = '';
  }
  
  el.modalTitleInput.value = tempItem.title || '';
  el.modalDescInput.value = tempItem.description || '';
  
  // Populate Folder options as clickable chips
  el.modalFolderChips.innerHTML = '';
  dbData.folders.forEach(f => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'folder-chip';
    chip.innerHTML = `<span class="folder-chip-icon">${f.icon || '📁'}</span> <span class="folder-chip-name">${escapeHtml(f.name)}</span>`;
    
    // Set custom properties for styling active state with this folder's specific color
    const folderColor = f.color || '#3b82f6';
    chip.style.setProperty('--active-color', folderColor);
    chip.style.setProperty('--active-border', folderColor);
    chip.style.setProperty('--active-bg', `${folderColor}1a`); // 10% opacity
    chip.style.setProperty('--active-shadow', `${folderColor}2a`); // 16% opacity
    
    chip.dataset.id = f.id;
    
    if (f.id === tempItem.folderId) {
      chip.classList.add('active');
    }
    
    chip.addEventListener('click', () => {
      // Deactivate other chips
      el.modalFolderChips.querySelectorAll('.folder-chip').forEach(c => c.classList.remove('active'));
      // Activate this chip
      chip.classList.add('active');
      // Set value
      tempItem.folderId = f.id;
    });
    
    el.modalFolderChips.appendChild(chip);
  });
  
  // Render Date active state hints
  updateModalTypeHint();
  
  // Render Tag Checklists inside Modal
  renderModalTags();
  
  // Toggle modal display
  el.modalDetail.classList.add('active');
  setTimeout(() => el.modalTitleInput.focus(), 150);
}

function updateModalTypeHint() {
  const dateVal = el.modalDatetimeInput.value;
  // Mark Date Quick Buttons as Active/Inactive
  document.querySelectorAll('.date-btn').forEach(btn => btn.classList.remove('active'));
  
  if (dateVal) {
    tempItem.type = 'task';
    el.modalTypeHint.textContent = 'Сохранится как: Задача (с чекбоксом)';
    el.modalTypeHint.style.color = 'var(--accent)';
  } else {
    tempItem.type = 'record';
    el.modalTypeHint.textContent = 'Сохранится как: Запись в CRM (лог)';
    el.modalTypeHint.style.color = 'var(--text-muted)';
  }
}

function renderModalTags() {
  el.modalTagsContainer.innerHTML = '';
  
  if (dbData.tags.length === 0) {
    el.modalTagsContainer.innerHTML = '<div style="color: var(--text-dark); font-style: italic; font-size: 0.85rem; text-align: center; padding: 10px 0;">Нет доступных тегов. Создайте их в настройках.</div>';
    return;
  }

  // 1. Tags Section
  const tagsSection = document.createElement('div');
  tagsSection.className = 'modal-chips-section';
  
  const tagsLabel = document.createElement('span');
  tagsLabel.className = 'chips-section-label';
  tagsLabel.textContent = 'Тег';
  tagsSection.appendChild(tagsLabel);
  
  const tagsRow = document.createElement('div');
  tagsRow.className = 'modal-chips-row';
  tagsSection.appendChild(tagsRow);
  
  dbData.tags.forEach(tag => {
    const isSelected = tempItem.tags.includes(tag.id);
    const btn = document.createElement('button');
    btn.className = `tag-chip-btn ${isSelected ? 'selected' : ''}`;
    btn.textContent = tag.name;
    
    if (isSelected) {
      btn.style.border = `2px solid ${tag.color}`;
      btn.style.boxShadow = `0 0 12px ${tag.color}40`;
    }
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (isSelected) {
        tempItem.tags = tempItem.tags.filter(id => id !== tag.id);
        // Deselect subtags belonging to this tag
        tag.subtags.forEach(sub => {
          tempItem.subtags = tempItem.subtags.filter(s => s !== sub);
        });
      } else {
        tempItem.tags.push(tag.id);
      }
      renderModalTags();
    });
    
    tagsRow.appendChild(btn);
  });
  
  el.modalTagsContainer.appendChild(tagsSection);
  
  // 2. Subtags Section
  const selectedTagsList = dbData.tags.filter(t => tempItem.tags.includes(t.id));
  const subtagsToRender = [];
  selectedTagsList.forEach(t => {
    t.subtags.forEach(sub => {
      subtagsToRender.push({ sub, tag: t });
    });
  });
  
  if (subtagsToRender.length > 0) {
    const subtagsSection = document.createElement('div');
    subtagsSection.className = 'modal-chips-section';
    
    const subtagsLabel = document.createElement('span');
    subtagsLabel.className = 'chips-section-label';
    subtagsLabel.textContent = 'Подтег';
    subtagsSection.appendChild(subtagsLabel);
    
    const subtagsRow = document.createElement('div');
    subtagsRow.className = 'modal-chips-row';
    subtagsSection.appendChild(subtagsRow);
    
    subtagsToRender.forEach(({ sub, tag }) => {
      const isSubSelected = tempItem.subtags.includes(sub);
      const subBtn = document.createElement('button');
      subBtn.className = `subtag-chip-btn ${isSubSelected ? 'selected' : ''}`;
      subBtn.textContent = sub;
      
      if (isSubSelected) {
        subBtn.style.color = tag.color;
        subBtn.style.borderColor = tag.color;
        subBtn.style.boxShadow = `0 0 8px ${tag.color}30`;
      } else {
        subBtn.style.color = 'var(--text-dark)';
      }
      
      subBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (isSubSelected) {
          tempItem.subtags = tempItem.subtags.filter(s => s !== sub);
        } else {
          tempItem.subtags.push(sub);
        }
        renderModalTags();
      });
      
      subtagsRow.appendChild(subBtn);
    });
    
    el.modalTagsContainer.appendChild(subtagsSection);
  }
}

function handleModalSave() {
  const titleText = el.modalTitleInput.value.trim();
  if (!titleText) {
    showToast('Название не может быть пустым!', true);
    return;
  }
  tempItem.title = titleText;
  tempItem.description = el.modalDescInput.value.trim();
  
  const activeFolderChip = el.modalFolderChips.querySelector('.folder-chip.active');
  tempItem.folderId = activeFolderChip ? activeFolderChip.dataset.id : (dbData.folders.length > 0 ? dbData.folders[0].id : 'inbox');
  const dateVal = el.modalDatetimeInput.value;
  tempItem.dateTime = dateVal ? new Date(dateVal).toISOString() : null;
  
  if (tempItem.id) {
    // Mode: EDIT existing
    const idx = dbData.items.findIndex(item => item.id === tempItem.id);
    if (idx !== -1) {
      const oldItem = dbData.items[idx];
      if (tempItem.outcome !== oldItem.outcome) {
        tempItem.outcomeSetAt = tempItem.outcome ? new Date().toISOString() : null;
      }
      tempItem.updatedAt = new Date().toISOString();
      dbData.items[idx] = { ...dbData.items[idx], ...tempItem };
    }
  } else {
    // Mode: CREATE new
    tempItem.id = 'item_' + Date.now();
    dbData.items.push(tempItem);
    
    // Clear editor inputs
    el.editorTitle.value = '';
    el.editorDescription.value = '';
    el.editorDescription.style.display = 'none';
  }
  
  saveData();
  el.modalDetail.classList.remove('active');
  
  // Autofocus title input back
  if (activeView === 'editor') {
    el.editorTitle.focus();
  }
}

// --- Quick Outcome Selection in Folder Item ---
function openQuickOutcomeModal(itemId) {
  if (dbData.outcomes.length === 0) {
    showToast('Пожалуйста, сначала создайте CRM исходы в настройках!', true);
    switchView('settings');
    return;
  }

  el.quickOutcomeItemId.value = itemId;
  el.quickOutcomeList.innerHTML = '';
  
  dbData.outcomes.forEach(outcome => {
    const btn = document.createElement('button');
    btn.className = 'outcome-select-btn';
    
    const dot = document.createElement('span');
    dot.className = 'tag-color-indicator';
    dot.style.backgroundColor = outcome.color;
    
    const label = document.createElement('span');
    label.textContent = outcome.name;
    
    btn.appendChild(dot);
    btn.appendChild(label);
    
    btn.addEventListener('click', () => {
      assignOutcomeToItem(itemId, outcome.id);
      el.modalQuickOutcome.classList.remove('active');
    });
    
    el.quickOutcomeList.appendChild(btn);
  });
  
  el.modalQuickOutcome.classList.add('active');
}

function assignOutcomeToItem(itemId, outcomeId) {
  const item = dbData.items.find(i => i.id === itemId);
  if (item) {
    item.outcome = outcomeId;
    item.outcomeSetAt = outcomeId ? new Date().toISOString() : null;
    item.updatedAt = new Date().toISOString();
    saveData();
  }
}

// --- Quick Folder Selection Modal (for quick save) ---
function openQuickFolderModal() {
  const titleVal = el.editorTitle.value.trim();
  if (!titleVal) return; // Guard
  
  if (dbData.folders.length === 0) {
    showToast('Пожалуйста, сначала создайте папку!', true);
    openFolderCreateModal();
    return;
  }
  
  el.quickFolderList.innerHTML = '';
  
  dbData.folders.forEach((folder, idx) => {
    const btn = document.createElement('button');
    btn.className = 'outcome-select-btn';
    btn.style.borderColor = folder.color + '40';
    
    const icon = document.createElement('span');
    icon.textContent = folder.icon || '📁';
    
    const name = document.createElement('span');
    name.textContent = `${folder.name} `;
    name.style.flexGrow = '1';
    
    // Add keyboard hint badge
    const badge = document.createElement('span');
    badge.className = 'key-badge';
    badge.style.fontSize = '0.75rem';
    badge.textContent = idx + 1;
    
    btn.appendChild(icon);
    btn.appendChild(name);
    btn.appendChild(badge);
    
    btn.addEventListener('click', () => {
      saveQuickItem(folder.id);
    });
    
    el.quickFolderList.appendChild(btn);
  });
  
  el.modalQuickFolder.classList.add('active');
  
  // Listen for keys 1-9
  window.addEventListener('keydown', handleQuickFolderKeydown);
}

function closeQuickFolderModal() {
  el.modalQuickFolder.classList.remove('active');
  window.removeEventListener('keydown', handleQuickFolderKeydown);
}

function handleQuickFolderKeydown(e) {
  const num = parseInt(e.key, 10);
  if (!isNaN(num) && num >= 1 && num <= dbData.folders.length) {
    e.preventDefault();
    const folder = dbData.folders[num - 1];
    if (folder) {
      saveQuickItem(folder.id);
    }
  } else if (e.key === 'Escape') {
    closeQuickFolderModal();
  }
}

function saveQuickItem(folderId) {
  const titleVal = el.editorTitle.value.trim();
  const descVal = el.editorDescription.value.trim();
  
  if (!titleVal) return;
  
  const newItem = {
    id: 'item_' + Date.now(),
    folderId: folderId,
    type: 'record', // always save as record (CRM log) on quick save
    title: titleVal,
    description: descVal,
    dateTime: null,
    tags: [],
    subtags: [],
    completed: false,
    outcome: null,
    createdAt: new Date().toISOString()
  };
  
  dbData.items.push(newItem);
  saveData();
  
  // Clear inputs
  el.editorTitle.value = '';
  el.editorDescription.value = '';
  el.editorDescription.style.display = 'none';
  
  closeQuickFolderModal();
  el.editorTitle.focus();
}

// --- Folder Management ---
// --- Folder Management ---
function openFolderCreateModal(folderId = null) {
  const isEdit = !!folderId;
  editingFolderId = folderId;
  
  const titleEl = document.getElementById('folder-modal-title');
  if (titleEl) {
    titleEl.textContent = isEdit ? 'Редактировать папку' : 'Создание папки';
  }
  el.modalFolderSave.textContent = isEdit ? 'Сохранить' : 'Создать';
  
  let folder = null;
  if (isEdit) {
    folder = dbData.folders.find(f => f.id === folderId);
  }
  
  el.folderNameInput.value = isEdit ? folder.name : '';
  el.folderIconInput.value = isEdit ? (folder.icon || '📁') : '📁';
  el.btnEmojiPicker.textContent = isEdit ? (folder.icon || '📁') : '📁';
  el.customEmojiInput.value = '';
  el.emojiPickerPopup.classList.remove('active');
  
  // Render Preset Colors Selector
  el.folderColorPalette.innerHTML = '';
  PRESET_COLORS.forEach((color, idx) => {
    const dot = document.createElement('div');
    const isSelected = isEdit ? (folder.color === color) : (idx === 0);
    dot.className = `color-option ${isSelected ? 'selected' : ''}`;
    dot.style.backgroundColor = color;
    dot.setAttribute('data-color', color);
    
    dot.addEventListener('click', () => {
      el.folderColorPalette.querySelectorAll('.color-option').forEach(c => c.classList.remove('selected'));
      dot.classList.add('selected');
    });
    el.folderColorPalette.appendChild(dot);
  });
  
  el.modalFolder.classList.add('active');
  setTimeout(() => el.folderNameInput.focus(), 150);
}

function handleFolderSave() {
  const nameVal = el.folderNameInput.value.trim();
  const iconVal = el.folderIconInput.value.trim();
  const selectedDot = el.folderColorPalette.querySelector('.color-option.selected');
  const colorVal = selectedDot ? selectedDot.getAttribute('data-color') : '#3b82f6';
  
  if (!nameVal) return;
  
  if (editingFolderId) {
    // Edit Mode
    const folder = dbData.folders.find(f => f.id === editingFolderId);
    if (folder) {
      folder.name = nameVal;
      folder.icon = iconVal || '📁';
      folder.color = colorVal;
    }
  } else {
    // Create Mode
    const newFolder = {
      id: 'folder_' + Date.now(),
      name: nameVal,
      color: colorVal,
      icon: iconVal || '📁'
    };
    dbData.folders.push(newFolder);
  }
  
  saveData();
  el.modalFolder.classList.remove('active');
}

async function handleDeleteFolder(folderId) {
  if (await showConfirm('Вы уверены, что хотите удалить эту папку и все её элементы?', 'Удаление папки')) {
    // Delete all folder items
    dbData.items = dbData.items.filter(item => item.folderId !== folderId);
    // Delete folder itself
    dbData.folders = dbData.folders.filter(f => f.id !== folderId);
    
    saveData();
    switchView('editor');
  }
}

async function handleDeleteItem(itemId) {
  if (await showConfirm('Вы уверены, что хотите удалить этот элемент?', 'Удаление элемента')) {
    dbData.items = dbData.items.filter(i => i.id !== itemId);
    saveData();
    if (activeView === 'folder' && activeFolderId) {
      renderFolderView(activeFolderId);
    }
  }
}

// --- HTML Escaping Helper for Telegram ---
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Client-Side Telegram Bot Long Polling ---
const pendingTasks = new Map();

function toLocalISOString(date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

async function startHandshakePolling(token, expectedCode, botUsername) {
  const sessionId = ++currentHandshakeSessionId;
  isHandshakePollingActive = true;
  
  // Get initial offset to skip old updates
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=1&offset=-1`);
    const data = await res.json();
    if (sessionId !== currentHandshakeSessionId) return;
    
    if (data.ok && data.result.length > 0) {
      handshakePollOffset = data.result[0].update_id + 1;
    } else {
      handshakePollOffset = 0;
    }
  } catch (e) {
    console.error('Error getting handshake offset:', e);
    handshakePollOffset = 0;
  }
  
  while (isHandshakePollingActive && sessionId === currentHandshakeSessionId) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${handshakePollOffset}&timeout=5`);
      const data = await res.json();
      
      if (sessionId !== currentHandshakeSessionId || !isHandshakePollingActive) break;
      
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          handshakePollOffset = update.update_id + 1;
          
          if (update.message && update.message.text) {
            const msgText = update.message.text.trim();
            const chatId = update.message.chat.id;
            const rawUser = update.message.from.username || update.message.from.first_name || 'User';
            const userDisplay = update.message.from.username ? ('@' + update.message.from.username) : rawUser;
            
            // Check for /start <PIN> or direct PIN match
            let codeVal = msgText;
            if (msgText.startsWith('/start ')) {
              codeVal = msgText.replace('/start ', '').trim();
            }
            
            if (codeVal === expectedCode) {
              // Linked successfully!
              isHandshakePollingActive = false;
              
              dbData.settings.telegram.token = token;
              dbData.settings.telegram.chatId = chatId.toString();
              dbData.settings.telegram.username = userDisplay;
              dbData.settings.telegram.isLinked = true;
              dbData.settings.telegram.lastUpdateId = handshakePollOffset; // set this so we don't re-process handshake updates!
              await saveData();
              
              // Send welcome confirmation back
              await sendTelegramMessage(token, chatId, `👋 Привет, <b>${escapeHtml(rawUser)}</b>! Устройство успешно подключено к Task & CRM Planner. Отправьте /menu для просмотра меню управления.`);
              
              // Start normal polling and scheduler
              startMessagePolling();
              startSchedulerTimer();
              
              updateTelegramUI();
              showToast(`Бот подключен к аккаунту ${userDisplay}!`);
              break;
            }
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      console.error('Handshake polling error:', e);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function startMessagePolling() {
  if (isMessagePollingActive) return;
  isMessagePollingActive = true;
  
  const token = dbData.settings.telegram.token;
  if (!token) {
    isMessagePollingActive = false;
    return;
  }

  // Resume from stored update ID or default to 0
  messagePollOffset = dbData.settings.telegram.lastUpdateId || 0;
  
  while (isMessagePollingActive) {
    const activeToken = dbData.settings.telegram.token;
    const activeChatId = dbData.settings.telegram.chatId;
    if (!activeToken || !activeChatId) {
      isMessagePollingActive = false;
      break;
    }
    
    try {
      const res = await fetch(`https://api.telegram.org/bot${activeToken}/getUpdates?offset=${messagePollOffset}&timeout=5`);
      const data = await res.json();
      
      if (!isMessagePollingActive) break;
      
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          messagePollOffset = update.update_id + 1;
          dbData.settings.telegram.lastUpdateId = messagePollOffset;
          await handleClientTelegramUpdate(update);
        }
        await saveData();
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Message polling error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function handleClientTelegramUpdate(update) {
  const token = dbData.settings.telegram.token;
  const linkedChatId = dbData.settings.telegram.chatId;
  const allowBotDbAccess = dbData.settings.telegram.allowBotDbAccess !== false;

  // 1. Process Callback Queries
  if (update.callback_query) {
    const callbackQuery = update.callback_query;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    // Only process from the linked chat
    if (linkedChatId && chatId.toString() === linkedChatId.toString()) {
      // Answer callback query first to dismiss loading spinner in TG client
      await answerTelegramCallback(token, callbackQuery.id);

      if (!allowBotDbAccess) {
        await sendTelegramMessage(token, chatId, `⚠️ Доступ к вашей базе данных Planner отключен в настройках приложения на ПК. Разрешите доступ в разделе 'Профиль Telegram'.`);
        return;
      }

      await handleTelegramCallbackQuery(chatId, messageId, data);
    }
    return;
  }

  // 2. Process Messages
  if (update.message) {
    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text ? message.text.trim() : '';

    // Only process from the linked chat
    if (linkedChatId && chatId.toString() === linkedChatId.toString()) {
      
      // Allow /ping and /test even if database access is disabled
      if (text === '/ping') {
        await sendTelegramMessage(token, chatId, `Pong! Связь с Planner активна ⚡`);
        return;
      }
      if (text === '/test') {
        await sendTelegramMessage(token, chatId, `🔔 <b>Диагностика связи:</b>\n• Статус: Активен ✅\n• Время на сервере: <code>${new Date().toLocaleTimeString()}</code>\n• Версия Planner: <code>1.0.0</code>\nТест пройден успешно!`);
        return;
      }
      if (text === '/myid' || text === '/info' || text === '/start') {
        await sendTelegramMessage(token, chatId, `👤 <b>Ваш профиль в Planner:</b>\n• ID чата: <code>${chatId}</code>\n• Имя: <code>${message.from.first_name || ''}</code>\n• Username: <code>${message.from.username ? ('@' + message.from.username) : 'отсутствует'}</code>\n\nИспользуйте этот ID чата и API токен бота для входа в Planner на мобильном телефоне.`);
        return;
      }

      // Check database access permission for all other operations
      if (!allowBotDbAccess) {
        await sendTelegramMessage(token, chatId, `⚠️ Доступ к вашей базе данных Planner отключен в настройках приложения на ПК. Разрешите доступ в разделе 'Профиль Telegram'.`);
        return;
      }

      // Check if this is a reply to an add task prompt
      if (message.reply_to_message && message.reply_to_message.text && text) {
        const replyToText = message.reply_to_message.text;
        const folderIdMatch = replyToText.match(/\[ID:\s*([a-zA-Z0-9_\-]+)\]/);
        if (folderIdMatch) {
          const folderId = folderIdMatch[1];
          const folder = dbData.folders.find(f => f.id === folderId);
          if (folder || folderId === 'inbox') {
            const lines = text.split('\n');
            const title = lines[0].trim();
            const description = lines.slice(1).join('\n').trim();
            
            const newItem = {
              id: 'tg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
              folderId: folderId,
              type: 'task',
              title: title,
              description: description,
              dateTime: null,
              tags: [],
              subtags: [],
              completed: false,
              createdAt: new Date().toISOString()
            };
            dbData.items.push(newItem);
            await saveData();

            const folderName = folder ? folder.name : 'Входящие';
            await sendTelegramMessage(token, chatId, `✅ Задача <b>"${escapeHtml(title)}"</b> добавлена в папку <b>"${escapeHtml(folderName)}"</b>!`, {
              inline_keyboard: [
                [
                  { text: `📂 Перейти в ${folderName}`, callback_data: `view_folder:${folderId}` },
                  { text: '⬅️ В главное меню', callback_data: 'main_menu' }
                ]
              ]
            });
            return;
          }
        }
      }

      // Handle other commands
      if (text === '/start' || text === '/menu') {
        await sendTelegramMainMenu(token, chatId);
        return;
      }

      if (text === '/status') {
        const activeTasks = dbData.items.filter(i => i.type === 'task' && !i.completed).length;
        await sendTelegramMessage(token, chatId, `Planner статус 📊:\nАктивных задач: ${activeTasks}`);
        return;
      }

      if (text.startsWith('/')) {
        await sendTelegramMessage(token, chatId, `Неизвестная команда. Доступные команды:\n/menu - главное меню\n/status - статус задач\n/ping - проверить связь\n/test - диагностика`);
        return;
      }

      // Default: process message text as new task added to default folder (inbox)
      if (text) {
        const lines = text.split('\n');
        const title = lines[0].trim();
        const description = lines.slice(1).join('\n').trim();
        
        pendingTasks.set(chatId, {
          title: title,
          description: description,
          folderId: null
        });

        const folders = dbData.folders;
        const inline_keyboard = [];
        
        if (folders.length === 0) {
          inline_keyboard.push([{ text: '📥 Входящие', callback_data: 'pend_folder:inbox' }]);
        } else {
          folders.forEach(f => {
            const icon = f.icon || '📁';
            inline_keyboard.push([{ text: `${icon} ${f.name}`, callback_data: `pend_folder:${f.id}` }]);
          });
        }
        inline_keyboard.push([{ text: '❌ Отмена', callback_data: 'pend_cancel' }]);

        const textMsg = `📥 <b>Новая задача:</b> ${escapeHtml(title)}\n${description ? `<i>Описание: ${escapeHtml(description)}</i>\n` : ''}\nШаг 1: Выберите папку для сохранения:`;
        await sendTelegramMessage(token, chatId, textMsg, { inline_keyboard });
      }
    }
  }
}

async function handleTelegramCallbackQuery(chatId, messageId, data) {
  if (data === 'main_menu') {
    const token = dbData.settings.telegram.token;
    await sendTelegramMainMenu(token, chatId, messageId);
  } else if (data === 'view_all_tasks') {
    await handleViewAllTasks(chatId, messageId);
  } else if (data === 'view_folders') {
    await handleViewFolders(chatId, messageId);
  } else if (data.startsWith('view_folder:')) {
    const folderId = data.substring('view_folder:'.length);
    await handleViewFolder(chatId, messageId, folderId);
  } else if (data.startsWith('task_detail:')) {
    const itemId = data.substring('task_detail:'.length);
    await handleTaskDetail(chatId, messageId, itemId);
  } else if (data.startsWith('toggle_task:')) {
    const itemId = data.substring('toggle_task:'.length);
    await handleToggleTask(chatId, messageId, itemId);
  } else if (data.startsWith('delete_task:')) {
    const itemId = data.substring('delete_task:'.length);
    await handleDeleteTask(chatId, messageId, itemId);
  } else if (data.startsWith('add_task:')) {
    const folderId = data.substring('add_task:'.length);
    await handleAddTaskPrompt(chatId, folderId);
  } else if (data.startsWith('pend_folder:')) {
    const folderId = data.substring('pend_folder:'.length);
    await handlePendingFolderSelect(chatId, messageId, folderId);
  } else if (data.startsWith('pend_time:')) {
    const timeOption = data.substring('pend_time:'.length);
    await handlePendingTimeSelect(chatId, messageId, timeOption);
  } else if (data === 'pend_cancel') {
    await handlePendingCancel(chatId, messageId);
  }
}

async function handlePendingFolderSelect(chatId, messageId, folderId) {
  const token = dbData.settings.telegram.token;
  const pendingTask = pendingTasks.get(chatId);
  if (!pendingTask) {
    await editTelegramMessage(token, chatId, messageId, `⚠️ Сессия создания задачи истекла. Пожалуйста, отправьте текст задачи заново.`);
    return;
  }
  
  pendingTask.folderId = folderId;
  const folder = dbData.folders.find(f => f.id === folderId);
  const folderName = folder ? folder.name : 'Входящие';
  const folderIcon = folder ? (folder.icon || '📁') : '📥';
  
  const textMsg = `📥 <b>Новая задача:</b> ${escapeHtml(pendingTask.title)}\n${pendingTask.description ? `<i>Описание: ${escapeHtml(pendingTask.description)}</i>\n` : ''}\n📁 <b>Папка:</b> ${folderIcon} ${escapeHtml(folderName)}\n\nШаг 2: Выберите срок выполнения задачи:`;
  
  const inline_keyboard = [
    [
      { text: '📅 Сегодня (18:00)', callback_data: 'pend_time:today' },
      { text: '📅 Завтра (12:00)', callback_data: 'pend_time:tomorrow' }
    ],
    [
      { text: '⏰ Через час', callback_data: 'pend_time:hour' },
      { text: '📭 Без времени', callback_data: 'pend_time:none' }
    ],
    [
      { text: '❌ Отмена', callback_data: 'pend_cancel' }
    ]
  ];
  
  await editTelegramMessage(token, chatId, messageId, textMsg, { inline_keyboard });
}

async function handlePendingTimeSelect(chatId, messageId, timeOption) {
  const token = dbData.settings.telegram.token;
  const pendingTask = pendingTasks.get(chatId);
  if (!pendingTask) {
    await editTelegramMessage(token, chatId, messageId, `⚠️ Сессия создания задачи истекла. Пожалуйста, отправьте текст задачи заново.`);
    return;
  }
  
  const folderId = pendingTask.folderId;
  const folder = dbData.folders.find(f => f.id === folderId);
  const folderName = folder ? folder.name : 'Входящие';
  const folderIcon = folder ? (folder.icon || '📁') : '📥';
  
  let targetDateTime = null;
  const now = new Date();
  let timeLabel = 'Без времени';
  
  if (timeOption === 'today') {
    now.setHours(18, 0, 0, 0);
    targetDateTime = toLocalISOString(now);
    timeLabel = `Сегодня (${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})`;
  } else if (timeOption === 'tomorrow') {
    now.setDate(now.getDate() + 1);
    now.setHours(12, 0, 0, 0);
    targetDateTime = toLocalISOString(now);
    timeLabel = `Завтра (${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})`;
  } else if (timeOption === 'hour') {
    now.setHours(now.getHours() + 1);
    targetDateTime = toLocalISOString(now);
    timeLabel = `Через час (${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})`;
  }
  
  if (folderId === 'inbox' && !dbData.folders.find(f => f.id === 'inbox')) {
    dbData.folders.push({ id: 'inbox', name: 'Входящие', color: '#3b82f6', icon: '📥' });
  }
  
  const newItem = {
    id: 'tg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    folderId: folderId,
    type: 'task',
    title: pendingTask.title,
    description: pendingTask.description,
    dateTime: targetDateTime,
    tags: [],
    subtags: [],
    completed: false,
    createdAt: new Date().toISOString()
  };
  
  dbData.items.push(newItem);
  await saveData();
  pendingTasks.delete(chatId);
  
  const textMsg = `✅ <b>Задача успешно добавлена!</b>\n\n<b>Название:</b> ${escapeHtml(pendingTask.title)}\n${pendingTask.description ? `<b>Описание:</b> <i>${escapeHtml(pendingTask.description)}</i>\n` : ''}<b>Папка:</b> ${folderIcon} ${escapeHtml(folderName)}\n<b>Срок:</b> <code>${timeLabel}</code>`;
  
  const inline_keyboard = [
    [
      { text: `📂 Перейти в ${folderName}`, callback_data: `view_folder:${folderId}` },
      { text: '⬅️ Главное меню', callback_data: 'main_menu' }
    ]
  ];
  
  await editTelegramMessage(token, chatId, messageId, textMsg, { inline_keyboard });
}

async function handlePendingCancel(chatId, messageId) {
  const token = dbData.settings.telegram.token;
  pendingTasks.delete(chatId);
  
  const textMsg = `❌ Добавление задачи отменено.`;
  const inline_keyboard = [
    [
      { text: '⬅️ Главное меню', callback_data: 'main_menu' }
    ]
  ];
  
  await editTelegramMessage(token, chatId, messageId, textMsg, { inline_keyboard });
}


async function sendTelegramMainMenu(token, chatId, messageId = null) {
  const activeTasks = dbData.items.filter(i => i.type === 'task' && !i.completed).length;
  const foldersCount = dbData.folders.length;
  const text = `⚡ <b>Главное меню Planner</b>\n\nУ вас <b>${activeTasks}</b> активных задач в <b>${foldersCount}</b> папках.\n\nИспользуйте кнопки ниже для навигации:`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: '📋 Все задачи', callback_data: 'view_all_tasks' },
        { text: '📂 Папки задач', callback_data: 'view_folders' }
      ],
      [
        { text: '🔄 Обновить статус', callback_data: 'main_menu' }
      ]
    ]
  };

  if (messageId) {
    const ok = await editTelegramMessage(token, chatId, messageId, text, keyboard);
    if (ok) return;
  }
  await sendTelegramMessage(token, chatId, text, keyboard);
}

async function handleViewAllTasks(chatId, messageId) {
  const token = dbData.settings.telegram.token;
  const activeTasks = dbData.items.filter(i => i.type === 'task' && !i.completed);
  const completedTasks = dbData.items.filter(i => i.type === 'task' && i.completed);
  
  let text = `📋 <b>Все задачи Planner</b>\n\n`;
  if (activeTasks.length === 0 && completedTasks.length === 0) {
    text += `У вас нет задач. Создайте их в приложении на ПК или через меню папок.`;
  } else {
    text += `<b>Активные задачи (${activeTasks.length}):</b>\n`;
    if (activeTasks.length === 0) {
      text += `<i>Нет активных задач</i>\n`;
    } else {
      activeTasks.slice(0, 15).forEach((task, idx) => {
        text += `${idx + 1}. ⬜ <b>${escapeHtml(task.title)}</b>\n`;
      });
      if (activeTasks.length > 15) {
        text += `<i>... и еще ${activeTasks.length - 15} задач</i>\n`;
      }
    }
    
    if (completedTasks.length > 0) {
      text += `\n<b>Выполненные задачи (${completedTasks.length}):</b>\n`;
      completedTasks.slice(0, 10).forEach((task, idx) => {
        text += `${idx + 1}. ✅ <s>${escapeHtml(task.title)}</s>\n`;
      });
      if (completedTasks.length > 10) {
        text += `<i>... и еще ${completedTasks.length - 10} задач</i>\n`;
      }
    }
  }

  const inline_keyboard = [];
  
  // Show active tasks as buttons (max 10 for neatness)
  activeTasks.slice(0, 10).forEach(task => {
    inline_keyboard.push([{
      text: `⬜ ${task.title.substring(0, 30)}${task.title.length > 30 ? '...' : ''}`,
      callback_data: `task_detail:${task.id}`
    }]);
  });

  inline_keyboard.push([{ text: '⬅️ Главное меню', callback_data: 'main_menu' }]);

  await editTelegramMessage(token, chatId, messageId, text, { inline_keyboard });
}

async function handleViewFolders(chatId, messageId) {
  const token = dbData.settings.telegram.token;
  const folders = dbData.folders;
  
  let text = `📂 <b>Папки задач в Planner</b>\n\nВыберите папку для просмотра задач или добавления новых:`;
  const inline_keyboard = [];

  if (folders.length === 0) {
    text += `\n\n<i>У вас пока нет папок. Вы можете создать их на ПК.</i>`;
  } else {
    folders.forEach(folder => {
      const count = dbData.items.filter(i => i.folderId === folder.id && i.type === 'task' && !i.completed).length;
      const icon = folder.icon || '📁';
      inline_keyboard.push([{
        text: `${icon} ${folder.name} (${count})`,
        callback_data: `view_folder:${folder.id}`
      }]);
    });
  }

  inline_keyboard.push([{ text: '⬅️ Главное меню', callback_data: 'main_menu' }]);

  await editTelegramMessage(token, chatId, messageId, text, { inline_keyboard });
}

async function handleViewFolder(chatId, messageId, folderId) {
  const token = dbData.settings.telegram.token;
  const folder = dbData.folders.find(f => f.id === folderId);
  if (!folder && folderId !== 'inbox') {
    await editTelegramMessage(token, chatId, messageId, `⚠️ Папка не найдена.`, {
      inline_keyboard: [[{ text: '⬅️ К папкам', callback_data: 'view_folders' }]]
    });
    return;
  }

  const folderName = folder ? folder.name : 'Входящие';
  const folderIcon = folder ? (folder.icon || '📁') : '📥';
  
  const folderItems = dbData.items.filter(i => i.folderId === folderId && i.type === 'task');
  const activeTasks = folderItems.filter(i => !i.completed);
  const completedTasks = folderItems.filter(i => i.completed);

  let text = `${folderIcon} <b>Папка: ${escapeHtml(folderName)}</b>\n\n`;
  if (folderItems.length === 0) {
    text += `В этой папке пока нет задач.`;
  } else {
    text += `<b>Активные задачи (${activeTasks.length}):</b>\n`;
    if (activeTasks.length === 0) {
      text += `<i>Нет активных задач</i>\n`;
    } else {
      activeTasks.slice(0, 15).forEach((task, idx) => {
        text += `${idx + 1}. ⬜ <b>${escapeHtml(task.title)}</b>\n`;
      });
      if (activeTasks.length > 15) {
        text += `<i>... и еще ${activeTasks.length - 15} задач</i>\n`;
      }
    }

    if (completedTasks.length > 0) {
      text += `\n<b>Выполненные задачи (${completedTasks.length}):</b>\n`;
      completedTasks.slice(0, 10).forEach((task, idx) => {
        text += `${idx + 1}. ✅ <s>${escapeHtml(task.title)}</s>\n`;
      });
      if (completedTasks.length > 10) {
        text += `<i>... и еще ${completedTasks.length - 10} задач</i>\n`;
      }
    }
  }

  const inline_keyboard = [];
  
  // List active tasks as buttons (max 10)
  activeTasks.slice(0, 10).forEach(task => {
    inline_keyboard.push([{
      text: `⬜ ${task.title.substring(0, 30)}${task.title.length > 30 ? '...' : ''}`,
      callback_data: `task_detail:${task.id}`
    }]);
  });

  // Navigation and action buttons
  inline_keyboard.push([
    { text: '➕ Добавить задачу', callback_data: `add_task:${folderId}` }
  ]);
  inline_keyboard.push([
    { text: '⬅️ К папкам', callback_data: 'view_folders' },
    { text: '⬅️ Главное меню', callback_data: 'main_menu' }
  ]);

  await editTelegramMessage(token, chatId, messageId, text, { inline_keyboard });
}

async function handleTaskDetail(chatId, messageId, itemId) {
  const token = dbData.settings.telegram.token;
  const task = dbData.items.find(i => i.id === itemId);
  if (!task) {
    await editTelegramMessage(token, chatId, messageId, `⚠️ Задача не найдена. Она могла быть удалена.`, {
      inline_keyboard: [[{ text: '⬅️ Главное меню', callback_data: 'main_menu' }]]
    });
    return;
  }

  const folder = dbData.folders.find(f => f.id === task.folderId);
  const folderName = folder ? folder.name : 'Входящие';
  const folderIcon = folder ? (folder.icon || '📁') : '📥';
  const statusText = task.completed ? '✅ Выполнено' : '⬜ Активно';

  let text = `📝 <b>Детали задачи</b>\n\n`;
  text += `<b>Название:</b> ${escapeHtml(task.title)}\n`;
  if (task.description) {
    text += `<b>Описание:</b> <i>${escapeHtml(task.description)}</i>\n`;
  }
  text += `<b>Папка:</b> ${folderIcon} ${escapeHtml(folderName)}\n`;
  text += `<b>Статус:</b> ${statusText}\n`;
  
  if (task.dateTime) {
    const date = new Date(task.dateTime);
    text += `<b>Запланировано на:</b> <code>${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</code>\n`;
  }
  
  text += `<b>Создано:</b> <code>${new Date(task.createdAt).toLocaleDateString()}</code>\n`;

  const inline_keyboard = [
    [
      { text: task.completed ? '⬜ Восстановить' : '✅ Выполнить', callback_data: `toggle_task:${task.id}` },
      { text: '🗑️ Удалить', callback_data: `delete_task:${task.id}` }
    ],
    [
      { text: `⬅️ Вернуться в папку`, callback_data: `view_folder:${task.folderId}` },
      { text: '⬅️ Главное меню', callback_data: 'main_menu' }
    ]
  ];

  await editTelegramMessage(token, chatId, messageId, text, { inline_keyboard });
}

async function handleToggleTask(chatId, messageId, itemId) {
  const task = dbData.items.find(i => i.id === itemId);
  if (task) {
    task.completed = !task.completed;
    task.updatedAt = new Date().toISOString();
    await saveData();
  }
  await handleTaskDetail(chatId, messageId, itemId);
}

async function handleDeleteTask(chatId, messageId, itemId) {
  const index = dbData.items.findIndex(i => i.id === itemId);
  let folderId = 'inbox';
  if (index !== -1) {
    folderId = dbData.items[index].folderId;
    dbData.items.splice(index, 1);
    await saveData();
  }
  
  const token = dbData.settings.telegram.token;
  await editTelegramMessage(token, chatId, messageId, `🗑️ Задача успешно удалена.`, {
    inline_keyboard: [
      [
        { text: `📂 Вернуться в папку`, callback_data: `view_folder:${folderId}` },
        { text: '⬅️ Главное меню', callback_data: 'main_menu' }
      ]
    ]
  });
}

async function handleAddTaskPrompt(chatId, folderId) {
  const token = dbData.settings.telegram.token;
  const folder = dbData.folders.find(f => f.id === folderId);
  const folderName = folder ? folder.name : 'Входящие';

  const text = `✍️ Введите название задачи для папки "${folderName}" [ID: ${folderId}]:\n\n<i>Отправьте ответным сообщением текст задачи. Первая строка будет названием, а последующие — описанием.</i>`;
  
  await sendTelegramMessage(token, chatId, text, {
    force_reply: true,
    input_field_placeholder: 'Название задачи...'
  });
}

// Send telegram message via client-side fetch
async function sendTelegramMessage(token, chatId, htmlText, replyMarkup = null) {
  try {
    const payload = {
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (e) {
    console.error('Error sending Telegram message:', e);
    return false;
  }
}

// Edit telegram message text and markup via client-side fetch
async function editTelegramMessage(token, chatId, messageId, htmlText, replyMarkup = null) {
  try {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text: htmlText,
      parse_mode: 'HTML'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (e) {
    console.error('Error editing Telegram message:', e);
    return false;
  }
}

// Answer Telegram callback query via client-side fetch
async function answerTelegramCallback(token, callbackQueryId, text = '') {
  try {
    const payload = {
      callback_query_id: callbackQueryId,
      text: text
    };
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (e) {
    console.error('Error answering Telegram callback query:', e);
    return false;
  }
}

function stopTelegramBackgroundServices() {
  isMessagePollingActive = false;
  isHandshakePollingActive = false;
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

// --- Scheduler & Reminder Agent (Runs every 20s) ---
function startSchedulerTimer() {
  if (schedulerInterval) clearInterval(schedulerInterval);
  schedulerInterval = setInterval(checkSchedulerReminders, 20000);
}

async function checkSchedulerReminders() {
  const tg = dbData.settings.telegram;
  if (!tg.isLinked || !tg.token || !tg.chatId) return;
  
  const now = new Date();
  
  // Format current local hours and minutes (e.g. "09:00")
  const currentLocalTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayStr = getLocalDateString(now);
  
  // 1. Morning Digest (Daily report)
  if (currentLocalTime === tg.tgMorningTime && tg.lastMorningNotifDate !== todayStr) {
    const todayTasks = dbData.items.filter(item => item.type === 'task' && !item.completed && isToday(item.dateTime));
    
    let message = `📅 <b>Ваш Planner на сегодня (${now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}):</b>\n\n`;
    
    if (todayTasks.length === 0) {
      message += `📋 На сегодня не запланировано активных задач. Отличный день, чтобы начать что-то новое!`;
    } else {
      // Group by folderId
      const groups = {};
      todayTasks.forEach(task => {
        if (!groups[task.folderId]) {
          groups[task.folderId] = [];
        }
        groups[task.folderId].push(task);
      });
      
      for (const [folderId, tasks] of Object.entries(groups)) {
        const folder = dbData.folders.find(f => f.id === folderId);
        const folderName = folder ? folder.name : 'Без папки';
        const folderIcon = folder ? (folder.icon + ' ') : '';
        message += `<b>${folderIcon}${escapeHtml(folderName)}:</b>\n`;
        tasks.forEach(task => {
          const timePart = new Date(task.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          message += `• [${timePart}] ID: <code>${task.id}</code> - ${escapeHtml(task.title)}\n`;
        });
        message += `\n`;
      }
      message = message.trim();
    }
    
    const sent = await sendTelegramMessage(tg.token, tg.chatId, message);
    if (sent) {
      tg.lastMorningNotifDate = todayStr;
      await saveData();
    }
  }
  
  // 2. Evening Report (Daily stats)
  if (currentLocalTime === tg.tgEveningTime && tg.lastEveningNotifDate !== todayStr) {
    const todayItems = dbData.items.filter(item => isToday(item.createdAt));
    
    // Count stats
    const completedTasksCount = dbData.items.filter(item => item.type === 'task' && item.completed && isToday(item.completedAt || item.createdAt)).length;
    const recordsCount = todayItems.filter(item => item.type === 'record').length;
    
    // Count CRM Outcomes set today
    const outcomesCounts = {};
    dbData.items.forEach(item => {
      if (item.outcome && item.outcomeSetAt && isToday(item.outcomeSetAt)) {
        const oObj = dbData.outcomes.find(o => o.id === item.outcome);
        if (oObj) {
          outcomesCounts[oObj.name] = (outcomesCounts[oObj.name] || 0) + 1;
        }
      }
    });
    
    let message = `📊 <b>Итоги дня (${now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}):</b>\n\n`;
    message += `• Выполнено задач: <b>${completedTasksCount}</b>\n`;
    message += `• Добавлено CRM записей: <b>${recordsCount}</b>\n`;
    
    if (Object.keys(outcomesCounts).length > 0) {
      message += `\n<b>Исходы CRM:</b>\n`;
      for (const [name, count] of Object.entries(outcomesCounts)) {
        message += `• ${name}: <b>${count}</b>\n`;
      }
    }
    
    const sent = await sendTelegramMessage(tg.token, tg.chatId, message);
    if (sent) {
      tg.lastEveningNotifDate = todayStr;
      await saveData();
    }
  }
  
  // 3. Task Reminders (30 and 5 minutes)
  const activeTasks = dbData.items.filter(item => item.type === 'task' && !item.completed && item.dateTime);
  
  for (const task of activeTasks) {
    const taskDate = new Date(task.dateTime);
    // Difference in minutes
    const diff = Math.round((taskDate - now) / 60000);
    
    const reminderId30 = `${task.id}_30`;
    const reminderId5 = `${task.id}_5`;
    
    // 30 Minutes Reminder
    if (diff <= 30 && diff > 28 && !tg.sentTgReminders.includes(reminderId30)) {
      const message = `⏰ <b>Напоминание (30 мин):</b>\nЗадача: <code>${task.id}</code> - <b>${escapeHtml(task.title)}</b>\n${task.description ? `<i>Описание: ${escapeHtml(task.description)}</i>` : ''}`;
      const sent = await sendTelegramMessage(tg.token, tg.chatId, message);
      if (sent) {
        tg.sentTgReminders.push(reminderId30);
        await saveData();
      }
    }
    
    // 5 Minutes Reminder
    if (diff <= 5 && diff > 3 && !tg.sentTgReminders.includes(reminderId5)) {
      const message = `⏰ <b>Напоминание (5 мин):</b>\nЗадача: <code>${task.id}</code> - <b>${escapeHtml(task.title)}</b>\n${task.description ? `<i>Описание: ${escapeHtml(task.description)}</i>` : ''}`;
      const sent = await sendTelegramMessage(tg.token, tg.chatId, message);
      if (sent) {
        tg.sentTgReminders.push(reminderId5);
        await saveData();
      }
    }
  }
}

// --- Telegram Bot Linking details ---
function updateTelegramUI() {
  const tg = dbData.settings.telegram;
  const navProfileLabel = el.navProfile.querySelector('.nav-label');
  
  if (tg.isLinked && tg.token) {
    el.tgDisconnectedSection.style.display = 'none';
    el.tgConnectedSection.style.display = 'block';
    el.tgLinkedChatId.textContent = tg.chatId;
    el.tgLinkedUsername.textContent = tg.username || '-';
    el.tgMorningTime.value = tg.tgMorningTime || '09:00';
    el.tgEveningTime.value = tg.tgEveningTime || '21:00';
    el.chkTgDbAccess.checked = tg.allowBotDbAccess !== false;
    
    if (tg.username) {
      navProfileLabel.textContent = tg.username.replace(/^@/, '');
    } else {
      navProfileLabel.textContent = 'Профиль Telegram';
    }
  } else {
    el.tgDisconnectedSection.style.display = 'block';
    el.tgConnectedSection.style.display = 'none';
    el.tgTokenInput.value = '';
    el.tgAuthCodeBox.style.display = 'none';
    navProfileLabel.textContent = 'Профиль Telegram';
  }
}

async function handleTelegramConnect() {
  const token = el.tgTokenInput.value.trim();
  if (!token) return;
  
  // Stop existing background polling and scheduler before handshake
  stopTelegramBackgroundServices();
  
  el.tgAuthCodeBox.style.display = 'flex';
  el.tgAuthCode.textContent = '...';
  
  try {
    // 1. getMe verification
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    
    if (data.ok && data.result.username) {
      const botUsername = data.result.username;
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      el.tgAuthCode.textContent = code;
      el.tgDeepLink.href = `https://t.me/${botUsername}?start=${code}`;
      
      // Start handshake updates listener loop
      startHandshakePolling(token, code, botUsername);
    } else {
      throw new Error(data.description || 'Не удалось авторизовать токен.');
    }
  } catch (err) {
    el.tgAuthCodeBox.style.display = 'none';
    isHandshakePollingActive = false; // Reset handshake polling state
    console.error('Connection error:', err);
    showToast(`Ошибка подключения к боту: ${err.message}`, true);
  }
}

// --- Settings Page Rendering & Configs ---
function renderSettingsView() {
  renderTagsSettings();
  renderOutcomesSettings();
}

// 1. Tags and Subtags Settings Editor
function renderTagsSettings() {
  el.tagsManagerList.innerHTML = '';
  
  if (dbData.tags.length === 0) {
    el.tagsManagerList.innerHTML = '<div style="color: var(--text-dark); padding: 12px; font-size: 0.9rem; font-style: italic; text-align: center;">Нет тегов. Создайте новый с помощью кнопки + выше.</div>';
    return;
  }

  dbData.tags.forEach(tag => {
    const item = document.createElement('div');
    item.className = 'tag-manager-item';
    
    const header = document.createElement('div');
    header.className = 'tag-manager-header';
    
    const meta = document.createElement('div');
    meta.className = 'tag-manager-meta';
    
    const dot = document.createElement('span');
    dot.className = 'tag-color-indicator';
    dot.style.backgroundColor = tag.color;
    
    const name = document.createElement('span');
    name.className = 'tag-manager-name';
    name.textContent = tag.name;
    
    meta.appendChild(dot);
    meta.appendChild(name);
    header.appendChild(meta);
    
    const actions = document.createElement('div');
    actions.className = 'actions-row';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'action-icon-btn';
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', () => openTagEditModal(tag));
    
    const delBtn = document.createElement('button');
    delBtn.className = 'action-icon-btn';
    delBtn.textContent = '🗑️';
    delBtn.addEventListener('click', () => handleDeleteTag(tag.id));
    
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    header.appendChild(actions);
    item.appendChild(header);
    
    // Subtags section
    const subList = document.createElement('div');
    subList.className = 'subtags-list';
    
    tag.subtags.forEach(sub => {
      const chip = document.createElement('div');
      chip.className = 'subtag-chip-edit';
      chip.textContent = sub;
      
      const removeSub = document.createElement('button');
      removeSub.className = 'subtag-remove-btn';
      removeSub.textContent = '×';
      removeSub.addEventListener('click', () => handleRemoveSubtag(tag.id, sub));
      
      chip.appendChild(removeSub);
      subList.appendChild(chip);
    });
    
    const addSubBtn = document.createElement('button');
    addSubBtn.className = 'btn-add-subtag';
    addSubBtn.textContent = '+ Подтег';
    addSubBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Название...';
      input.style.width = '100px';
      input.style.padding = '2px 8px';
      input.style.fontSize = '0.75rem';
      input.style.borderRadius = '12px';
      input.style.border = '1px solid var(--accent)';
      input.style.background = 'rgba(0,0,0,0.2)';
      input.style.color = 'var(--text-main)';
      input.style.outline = 'none';
      
      const saveSub = () => {
        const val = input.value.trim();
        if (val) {
          if (!tag.subtags.includes(val)) {
            tag.subtags.push(val);
            saveData();
            renderSettingsView();
          } else {
            showToast('Такой подтег уже существует!', true);
            renderSettingsView();
          }
        } else {
          renderSettingsView();
        }
      };
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          saveSub();
        } else if (e.key === 'Escape') {
          renderSettingsView();
        }
      });
      
      input.addEventListener('blur', () => {
        saveSub();
      });
      
      addSubBtn.replaceWith(input);
      input.focus();
    });
    
    subList.appendChild(addSubBtn);
    item.appendChild(subList);
    
    el.tagsManagerList.appendChild(item);
  });
}

function openTagEditModal(tag = null) {
  if (tag) {
    el.tagEditId.value = tag.id;
    el.tagNameInput.value = tag.name;
    el.tagModalTitle.textContent = 'Редактировать тег';
  } else {
    el.tagEditId.value = '';
    el.tagNameInput.value = '';
    el.tagModalTitle.textContent = 'Создать тег';
  }
  
  // Render colors selector
  el.tagColorPalette.innerHTML = '';
  PRESET_COLORS.forEach((color, idx) => {
    const dot = document.createElement('div');
    dot.className = 'color-option';
    dot.style.backgroundColor = color;
    dot.setAttribute('data-color', color);
    
    if (tag && tag.color === color) dot.classList.add('selected');
    else if (!tag && idx === 0) dot.classList.add('selected');
    
    dot.addEventListener('click', () => {
      el.tagColorPalette.querySelectorAll('.color-option').forEach(c => c.classList.remove('selected'));
      dot.classList.add('selected');
    });
    el.tagColorPalette.appendChild(dot);
  });
  
  el.modalTagCreate.classList.add('active');
  setTimeout(() => el.tagNameInput.focus(), 150);
}

function handleTagSave() {
  const idVal = el.tagEditId.value;
  const nameVal = el.tagNameInput.value.trim();
  const selectedDot = el.tagColorPalette.querySelector('.color-option.selected');
  const colorVal = selectedDot ? selectedDot.getAttribute('data-color') : '#3b82f6';
  
  if (!nameVal) return;
  
  if (idVal) {
    const tag = dbData.tags.find(t => t.id === idVal);
    if (tag) {
      tag.name = nameVal;
      tag.color = colorVal;
    }
  } else {
    const newTag = {
      id: 'tag_' + Date.now(),
      name: nameVal,
      color: colorVal,
      subtags: []
    };
    dbData.tags.push(newTag);
  }
  
  saveData();
  renderSettingsView();
  el.modalTagCreate.classList.remove('active');
}

async function handleDeleteTag(tagId) {
  if (await showConfirm('Удалить этот тег? Он исчезнет из всех задач/записей.', 'Удаление тега')) {
    dbData.tags = dbData.tags.filter(t => t.id !== tagId);
    
    // Remove references in items
    dbData.items.forEach(item => {
      item.tags = item.tags.filter(t => t !== tagId);
    });
    
    saveData();
    renderSettingsView();
  }
}



function handleRemoveSubtag(tagId, subName) {
  const tag = dbData.tags.find(t => t.id === tagId);
  if (tag) {
    tag.subtags = tag.subtags.filter(s => s !== subName);
    
    // Clean up items referencing this subtag
    dbData.items.forEach(item => {
      item.subtags = item.subtags.filter(s => s !== subName);
    });
    
    saveData();
    renderSettingsView();
  }
}

// 2. Outcomes Settings Editor
function renderOutcomesSettings() {
  el.outcomesManagerList.innerHTML = '';
  
  if (dbData.outcomes.length === 0) {
    el.outcomesManagerList.innerHTML = '<div style="color: var(--text-dark); padding: 12px; font-size: 0.9rem; font-style: italic; text-align: center;">Нет исходов. Создайте новый с помощью кнопки + выше.</div>';
    return;
  }

  dbData.outcomes.forEach(outcome => {
    const item = document.createElement('div');
    item.className = 'outcome-manager-item';
    
    const meta = document.createElement('div');
    meta.className = 'tag-manager-meta';
    
    const dot = document.createElement('span');
    dot.className = 'tag-color-indicator';
    dot.style.backgroundColor = outcome.color;
    
    const name = document.createElement('span');
    name.className = 'tag-manager-name';
    name.textContent = outcome.name;
    
    meta.appendChild(dot);
    meta.appendChild(name);
    item.appendChild(meta);
    
    const actions = document.createElement('div');
    actions.className = 'actions-row';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'action-icon-btn';
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', () => openOutcomeEditModal(outcome));
    
    const delBtn = document.createElement('button');
    delBtn.className = 'action-icon-btn';
    delBtn.textContent = '🗑️';
    delBtn.addEventListener('click', () => handleDeleteOutcome(outcome.id));
    
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    item.appendChild(actions);
    
    el.outcomesManagerList.appendChild(item);
  });
}

function openOutcomeEditModal(outcome = null) {
  if (outcome) {
    el.outcomeEditId.value = outcome.id;
    el.outcomeNameInput.value = outcome.name;
    el.outcomeModalTitle.textContent = 'Редактировать исход';
  } else {
    el.outcomeEditId.value = '';
    el.outcomeNameInput.value = '';
    el.outcomeModalTitle.textContent = 'Создать исход';
  }
  
  // Render colors selector
  el.outcomeColorPalette.innerHTML = '';
  PRESET_COLORS.forEach((color, idx) => {
    const dot = document.createElement('div');
    dot.className = 'color-option';
    dot.style.backgroundColor = color;
    dot.setAttribute('data-color', color);
    
    if (outcome && outcome.color === color) dot.classList.add('selected');
    else if (!outcome && idx === 0) dot.classList.add('selected');
    
    dot.addEventListener('click', () => {
      el.outcomeColorPalette.querySelectorAll('.color-option').forEach(c => c.classList.remove('selected'));
      dot.classList.add('selected');
    });
    el.outcomeColorPalette.appendChild(dot);
  });
  
  el.modalOutcome.classList.add('active');
  setTimeout(() => el.outcomeNameInput.focus(), 150);
}

function handleOutcomeSave() {
  const idVal = el.outcomeEditId.value;
  const nameVal = el.outcomeNameInput.value.trim();
  const selectedDot = el.outcomeColorPalette.querySelector('.color-option.selected');
  const colorVal = selectedDot ? selectedDot.getAttribute('data-color') : '#3b82f6';
  
  if (!nameVal) return;
  
  if (idVal) {
    const outcome = dbData.outcomes.find(o => o.id === idVal);
    if (outcome) {
      outcome.name = nameVal;
      outcome.color = colorVal;
    }
  } else {
    const newOutcome = {
      id: 'outcome_' + Date.now(),
      name: nameVal,
      color: colorVal
    };
    dbData.outcomes.push(newOutcome);
  }
  
  saveData();
  renderSettingsView();
  el.modalOutcome.classList.remove('active');
}

async function handleDeleteOutcome(outcomeId) {
  if (await showConfirm('Удалить этот исход?', 'Удаление исхода')) {
    dbData.outcomes = dbData.outcomes.filter(o => o.id !== outcomeId);
    
    // Remove reference in items
    dbData.items.forEach(item => {
      if (item.outcome === outcomeId) item.outcome = null;
    });
    
    saveData();
    renderSettingsView();
  }
}

// 3. Hotkeys settings handler
async function handleSaveGlobalShortcut() {
  const str = el.bindGlobal.value.trim();
  if (str) {
    dbData.settings.keybindings.globalShortcut = str;
    const success = await window.api.settings.updateGlobalShortcut(str);
    if (success) {
      showToast(`Глобальный шорткат обновлен на ${str}`);
      saveData();
    }
  }
}

// --- Dynamic Shortcut Matching Helpers ---
function matchShortcut(e, shortcutString) {
  if (!shortcutString) return false;
  const parts = shortcutString.split('+');
  const key = parts[parts.length - 1].toUpperCase();
  
  const hasCtrl = parts.includes('Ctrl');
  const hasShift = parts.includes('Shift');
  const hasAlt = parts.includes('Alt');
  
  let eventKey = e.key;
  if (eventKey === ' ') eventKey = 'Space';
  eventKey = eventKey.toUpperCase();
  
  return (e.ctrlKey === hasCtrl) && 
         (e.shiftKey === hasShift) && 
         (e.altKey === hasAlt) && 
         (eventKey === key);
}

function setupShortcutCapturer(inputEl) {
  inputEl.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    
    let keyName = e.key;
    if (keyName === ' ') keyName = 'Space';
    if (keyName.length === 1) keyName = keyName.toUpperCase();
    
    parts.push(keyName);
    inputEl.value = parts.join('+');
  });
}

// --- Key Event Listeners Setup ---
function setupEventListeners() {
  // Titlebar controls
  el.btnMinimize.addEventListener('click', () => window.api.system.minimize());
  el.btnClose.addEventListener('click', () => window.api.system.close());
  
  // Navigation
  el.navEditor.addEventListener('click', () => switchView('editor'));
  el.navProfile.addEventListener('click', () => switchView('profile'));
  el.navSettings.addEventListener('click', () => switchView('settings'));
  el.btnAddFolder.addEventListener('click', () => openFolderCreateModal());
  el.btnDeleteFolder.addEventListener('click', () => handleDeleteFolder(activeFolderId));
  
  // Editor Key Binding Routines
  el.editorTitle.addEventListener('keydown', (e) => {
    const newlineBind = dbData.settings.keybindings.newline;
    const saveBind = dbData.settings.keybindings.save;
    
    if (matchShortcut(e, newlineBind)) {
      e.preventDefault();
      el.editorDescription.style.display = 'block';
      el.editorDescription.focus();
    } else if (matchShortcut(e, saveBind)) {
      e.preventDefault();
      openQuickFolderModal();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openDetailModal();
    }
  });

  el.editorDescription.addEventListener('keydown', (e) => {
    const saveBind = dbData.settings.keybindings.save;
    
    if (matchShortcut(e, saveBind)) {
      e.preventDefault();
      openQuickFolderModal();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openDetailModal();
    } else if (e.key === 'Backspace' && el.editorDescription.value.trim() === '') {
      e.preventDefault();
      el.editorDescription.value = '';
      el.editorDescription.style.display = 'none';
      el.editorTitle.focus();
    }
  });
  
  // Detail Modal Actions
  el.modalClose.addEventListener('click', () => el.modalDetail.classList.remove('active'));
  el.modalCancelBtn.addEventListener('click', () => el.modalDetail.classList.remove('active'));
  el.modalSaveBtn.addEventListener('click', handleModalSave);
  
  // Date quick buttons inside details modal
  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = btn.getAttribute('data-time');
      const now = new Date();
      
      document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
      
      const toLocalISO = (date) => {
        const tzOffset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
      };
      
      if (type === 'today') {
        now.setHours(18, 0, 0, 0); // Default to today at 18:00
        el.modalDatetimeInput.value = toLocalISO(now);
        btn.classList.add('active');
      } else if (type === 'tomorrow') {
        now.setDate(now.getDate() + 1);
        now.setHours(12, 0, 0, 0); // Default to tomorrow at 12:00
        el.modalDatetimeInput.value = toLocalISO(now);
        btn.classList.add('active');
      } else if (type === 'hour') {
        now.setHours(now.getHours() + 1);
        el.modalDatetimeInput.value = toLocalISO(now);
        btn.classList.add('active');
      }
      updateModalTypeHint();
    });
  });
  
  el.btnDateClear.addEventListener('click', () => {
    el.modalDatetimeInput.value = '';
    document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
    updateModalTypeHint();
  });
  
  el.modalDatetimeInput.addEventListener('change', () => {
    document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
    updateModalTypeHint();
  });
  
  // Folder modal
  el.modalFolderClose.addEventListener('click', () => el.modalFolder.classList.remove('active'));
  el.modalFolderCancel.addEventListener('click', () => el.modalFolder.classList.remove('active'));
  el.modalFolderSave.addEventListener('click', handleFolderSave);
  
  // Toggle emoji picker popup
  el.btnEmojiPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = el.emojiPickerPopup.classList.toggle('active');
    if (isActive) {
      setTimeout(() => el.customEmojiInput.focus(), 50);
    }
  });

  // Handle custom emoji typing
  el.customEmojiInput.addEventListener('input', () => {
    const val = el.customEmojiInput.value.trim();
    if (val) {
      el.folderIconInput.value = val;
      el.btnEmojiPicker.textContent = val;
    } else {
      el.folderIconInput.value = '📁';
      el.btnEmojiPicker.textContent = '📁';
    }
  });

  // Handle emoji selection
  el.emojiPickerPopup.querySelectorAll('.emoji-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = item.textContent;
      el.folderIconInput.value = emoji;
      el.btnEmojiPicker.textContent = emoji;
      el.customEmojiInput.value = ''; // Clear custom input since preset was chosen
      el.emojiPickerPopup.classList.remove('active');
    });
  });

  // Close emoji picker if clicked outside
  document.addEventListener('click', (e) => {
    if (el.emojiPickerPopup.classList.contains('active') && !e.target.closest('.emoji-selector-container')) {
      el.emojiPickerPopup.classList.remove('active');
    }
  });
  
  // Tag Modal
  el.modalTagClose.addEventListener('click', () => el.modalTagCreate.classList.remove('active'));
  el.modalTagCancel.addEventListener('click', () => el.modalTagCreate.classList.remove('active'));
  el.modalTagSave.addEventListener('click', handleTagSave);
  el.btnAddTag.addEventListener('click', () => openTagEditModal());
  
  // Outcome Modal
  el.modalOutcomeClose.addEventListener('click', () => el.modalOutcome.classList.remove('active'));
  el.modalOutcomeCancel.addEventListener('click', () => el.modalOutcome.classList.remove('active'));
  el.modalOutcomeSave.addEventListener('click', handleOutcomeSave);
  el.btnAddOutcome.addEventListener('click', () => openOutcomeEditModal());
  
  // Quick Outcome Modal
  el.modalQuickOutcomeClose.addEventListener('click', () => el.modalQuickOutcome.classList.remove('active'));
  el.btnQuickOutcomeClear.addEventListener('click', () => {
    const itemId = el.quickOutcomeItemId.value;
    assignOutcomeToItem(itemId, null);
    el.modalQuickOutcome.classList.remove('active');
  });

  // Quick Folder Modal Close
  el.modalQuickFolderClose.addEventListener('click', closeQuickFolderModal);
  
  // Keybindings shortcut capturers
  setupShortcutCapturer(el.bindNewline);
  setupShortcutCapturer(el.bindSave);
  setupShortcutCapturer(el.bindGlobal);

  // Keybindings save click actions
  el.btnSaveNewline.addEventListener('click', () => {
    const str = el.bindNewline.value.trim();
    if (str) {
      dbData.settings.keybindings.newline = str;
      el.badgeNewline.textContent = str;
      saveData();
      showToast(`Шорткат переноса строки изменен на: ${str}`);
    }
  });

  el.btnSaveSave.addEventListener('click', () => {
    const str = el.bindSave.value.trim();
    if (str) {
      dbData.settings.keybindings.save = str;
      saveData();
      showToast(`Шорткат быстрого сохранения изменен на: ${str}`);
    }
  });
  
  el.btnSaveGlobalShortcut.addEventListener('click', handleSaveGlobalShortcut);
  
  // Autostart startup setting
  el.chkAutostart.addEventListener('change', () => {
    const enable = el.chkAutostart.checked;
    dbData.settings.system.runOnStartup = enable;
    window.api.settings.setAutoLaunch(enable);
    saveData();
  });
  
  // Hide to tray setting
  el.chkHideToTray.addEventListener('change', () => {
    dbData.settings.system.hideToTray = el.chkHideToTray.checked;
    saveData();
  });
  
  // DB Export & Import actions
  el.btnExportDb.addEventListener('click', async () => {
    const destPath = await window.api.system.selectExportPath();
    if (destPath) {
      const res = await window.api.database.export(destPath);
      if (res.success) {
        showToast('Резервная копия БД успешно экспортирована!');
      } else {
        showToast(`Ошибка экспорта: ${res.error}`, true);
      }
    }
  });
  
  el.btnImportDb.addEventListener('click', async () => {
    const srcPath = await window.api.system.selectImportPath();
    if (srcPath) {
      if (await showConfirm('Внимание! Импорт перезапишет текущую базу данных. Вы хотите продолжить?', 'Импорт базы данных')) {
        const res = await window.api.database.import(srcPath);
        if (res.success) {
          showToast('База данных успешно импортирована!');
          await loadData();
          if (activeView === 'folder' && activeFolderId) {
            renderFolderView(activeFolderId);
          }
        } else {
          showToast(`Ошибка импорта: ${res.error}`, true);
        }
      }
    }
  });
  
  // Telegram Bot connections
  el.btnTgConnect.addEventListener('click', handleTelegramConnect);
  
  el.tgAuthCode.addEventListener('click', () => {
    const code = el.tgAuthCode.textContent;
    if (code && code !== '------' && code !== '...') {
      copyTextToClipboard(code, el.tgAuthCode.parentElement);
    }
  });

  el.btnTgTest.addEventListener('click', async () => {
    const token = dbData.settings.telegram.token;
    const chatId = dbData.settings.telegram.chatId;
    const username = dbData.settings.telegram.username || 'пользователь';
    
    if (token && chatId) {
      const sent = await sendTelegramMessage(token, chatId, `🔔 <b>Тест связи:</b>\nУстройство успешно отправляет и принимает сообщения!\nПривет, <b>${escapeHtml(username)}</b>.`);
      if (sent) {
        showToast('Тестовое сообщение успешно отправлено!');
      } else {
        showToast('Ошибка при отправке тестового сообщения.', true);
      }
    } else {
      showToast('Ошибка: Telegram-бот еще не подключен.', true);
    }
  });

  el.btnTgUnlink.addEventListener('click', async () => {
    if (await showConfirm('Вы уверены, что хотите отключить Telegram-бота?', 'Отключение Telegram-бота')) {
      stopTelegramBackgroundServices();
      dbData.settings.telegram.isLinked = false;
      dbData.settings.telegram.token = '';
      dbData.settings.telegram.chatId = '';
      dbData.settings.telegram.username = '';
      dbData.settings.telegram.lastUpdateId = 0; // Reset
      await saveData();
      updateTelegramUI();
    }
  });

  // Watch time settings in profile for morning & evening notifications
  el.tgMorningTime.addEventListener('change', async () => {
    dbData.settings.telegram.tgMorningTime = el.tgMorningTime.value;
    await saveData();
  });

  el.tgEveningTime.addEventListener('change', async () => {
    dbData.settings.telegram.tgEveningTime = el.tgEveningTime.value;
    await saveData();
  });

  el.chkTgDbAccess.addEventListener('change', async () => {
    dbData.settings.telegram.allowBotDbAccess = el.chkTgDbAccess.checked;
    await saveData();
  });
  
  // Track last focused input element globally
  document.addEventListener('focusin', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      lastFocusedInput = e.target;
    }
  });

  // Intercept all links to open in the system default browser
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href && (link.href.startsWith('http://') || link.href.startsWith('https://'))) {
      e.preventDefault();
      window.api.system.openExternal(link.href);
    }
  });

  // Global Hotkey triggered callback
  window.api.events.onShortcutPressed((clipText) => {
    switchView('editor');
    el.editorTitle.focus();
    
    // Automatically paste text from clipboard if there is any
    if (clipText && clipText.trim()) {
      el.editorTitle.value = clipText.trim();
      el.editorDescription.value = '';
      el.editorDescription.style.display = 'none';
    }
  });

  // Global window focused event callback to restore cursor focus
  window.api.events.onWindowFocused(() => {
    // If there is a last focused input that is still visible and connected to DOM, restore it
    if (lastFocusedInput && document.body.contains(lastFocusedInput) && lastFocusedInput.offsetParent !== null) {
      lastFocusedInput.focus();
      return;
    }

    const activeModal = document.querySelector('.modal-overlay.active');
    if (activeModal) {
      const firstInput = activeModal.querySelector('input:not([readonly]), textarea, select');
      if (firstInput) {
        firstInput.focus();
        return;
      }
    }
    if (activeView === 'editor') {
      el.editorTitle.focus();
    }
  });

  // Focus recovery on neutral document click
  document.body.addEventListener('click', (e) => {
    if (activeView === 'editor' && 
        e.target !== el.editorTitle && 
        e.target !== el.editorDescription && 
        e.target.tagName !== 'INPUT' && 
        e.target.tagName !== 'TEXTAREA' && 
        e.target.tagName !== 'BUTTON' && 
        e.target.tagName !== 'SELECT' && 
        e.target.tagName !== 'A' &&
        !e.target.closest('.item-card') && // Don't steal copy focus
        !document.querySelector('.modal-overlay.active')) {
      
      const selection = window.getSelection().toString();
      if (!selection) {
        el.editorTitle.focus();
      }
    }
  });
}

// --- Custom Context Menu Logic ---
function wrapSelection(inputElement, wrapBefore, wrapAfter = wrapBefore) {
  const start = inputElement.selectionStart;
  const end = inputElement.selectionEnd;
  const text = inputElement.value;
  const selectedText = text.substring(start, end);
  
  const newText = text.substring(0, start) + wrapBefore + selectedText + wrapAfter + text.substring(end);
  inputElement.value = newText;
  
  // Restore selection / focus
  inputElement.focus();
  const newStart = start + wrapBefore.length;
  const newEnd = newStart + selectedText.length;
  inputElement.setSelectionRange(newStart, newEnd);
  
  // Trigger input event to update database state
  inputElement.dispatchEvent(new Event('input'));
}

function initContextMenu() {
  const menu = el.customContextMenu;
  const list = el.contextMenuList;
  
  document.addEventListener('contextmenu', (e) => {
    // Determine the context target
    const folderBtn = e.target.closest('.nav-folder-btn');
    const itemCard = e.target.closest('.item-card');
    const textInput = e.target.closest('input[type="text"], textarea');
    
    // If not clicked on folders, cards, or inputs, let default browser menu run or just close ours
    if (!folderBtn && !itemCard && !textInput) {
      menu.style.display = 'none';
      return;
    }
    
    e.preventDefault();
    list.innerHTML = '';
    
    // Calculate display position
    let x = e.pageX;
    let y = e.pageY;
    
    // Prevent menu overflowing the viewport edges
    const menuWidth = 170;
    const menuHeight = 250;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    
    if (folderBtn) {
      const folderId = folderBtn.getAttribute('data-id');
      
      const editOpt = document.createElement('li');
      editOpt.className = 'context-menu-item';
      editOpt.innerHTML = '✏️ Редактировать';
      editOpt.addEventListener('click', () => {
        menu.style.display = 'none';
        openFolderCreateModal(folderId);
      });
      
      const delOpt = document.createElement('li');
      delOpt.className = 'context-menu-item';
      delOpt.style.color = 'var(--danger)';
      delOpt.innerHTML = '🗑️ Удалить';
      delOpt.addEventListener('click', async () => {
        menu.style.display = 'none';
        await handleDeleteFolder(folderId);
      });
      
      list.appendChild(editOpt);
      list.appendChild(delOpt);
      
    } else if (itemCard) {
      const itemId = itemCard.getAttribute('data-id');
      const item = dbData.items.find(i => i.id === itemId);
      
      const editOpt = document.createElement('li');
      editOpt.className = 'context-menu-item';
      editOpt.innerHTML = '✏️ Редактировать';
      editOpt.addEventListener('click', () => {
        menu.style.display = 'none';
        openDetailModal(item);
      });
      
      const delOpt = document.createElement('li');
      delOpt.className = 'context-menu-item';
      delOpt.style.color = 'var(--danger)';
      delOpt.innerHTML = '🗑️ Удалить';
      delOpt.addEventListener('click', async () => {
        menu.style.display = 'none';
        await handleDeleteItem(itemId);
      });
      
      list.appendChild(editOpt);
      list.appendChild(delOpt);
      
    } else if (textInput) {
      // Check if text is selected
      const hasSelection = textInput.selectionStart !== textInput.selectionEnd;
      
      // Formatting options (only if we have selection)
      const boldOpt = document.createElement('li');
      boldOpt.className = `context-menu-item ${!hasSelection ? 'disabled' : ''}`;
      boldOpt.style.opacity = hasSelection ? '1' : '0.4';
      boldOpt.style.pointerEvents = hasSelection ? 'auto' : 'none';
      boldOpt.innerHTML = '<b>Ж</b> Жирный';
      boldOpt.addEventListener('click', () => {
        menu.style.display = 'none';
        wrapSelection(textInput, '**');
      });
      
      const italicOpt = document.createElement('li');
      italicOpt.className = `context-menu-item ${!hasSelection ? 'disabled' : ''}`;
      italicOpt.style.opacity = hasSelection ? '1' : '0.4';
      italicOpt.style.pointerEvents = hasSelection ? 'auto' : 'none';
      italicOpt.innerHTML = '<i>К</i> Курсив';
      italicOpt.addEventListener('click', () => {
        menu.style.display = 'none';
        wrapSelection(textInput, '*');
      });

      const highlightOpt = document.createElement('li');
      highlightOpt.className = `context-menu-item ${!hasSelection ? 'disabled' : ''}`;
      highlightOpt.style.opacity = hasSelection ? '1' : '0.4';
      highlightOpt.style.pointerEvents = hasSelection ? 'auto' : 'none';
      highlightOpt.innerHTML = '🖍️ Маркер';
      highlightOpt.addEventListener('click', () => {
        menu.style.display = 'none';
        wrapSelection(textInput, '==');
      });

      const codeOpt = document.createElement('li');
      codeOpt.className = `context-menu-item ${!hasSelection ? 'disabled' : ''}`;
      codeOpt.style.opacity = hasSelection ? '1' : '0.4';
      codeOpt.style.pointerEvents = hasSelection ? 'auto' : 'none';
      codeOpt.innerHTML = '<code>Код</code>';
      codeOpt.addEventListener('click', () => {
        menu.style.display = 'none';
        wrapSelection(textInput, '`');
      });

      const divider = document.createElement('div');
      divider.className = 'context-menu-divider';

      const cutOpt = document.createElement('li');
      cutOpt.className = `context-menu-item ${!hasSelection ? 'disabled' : ''}`;
      cutOpt.style.opacity = hasSelection ? '1' : '0.4';
      cutOpt.style.pointerEvents = hasSelection ? 'auto' : 'none';
      cutOpt.innerHTML = '✂️ Вырезать';
      cutOpt.addEventListener('click', () => {
        menu.style.display = 'none';
        textInput.focus();
        document.execCommand('cut');
      });

      const copyOpt = document.createElement('li');
      copyOpt.className = `context-menu-item ${!hasSelection ? 'disabled' : ''}`;
      copyOpt.style.opacity = hasSelection ? '1' : '0.4';
      copyOpt.style.pointerEvents = hasSelection ? 'auto' : 'none';
      copyOpt.innerHTML = '📋 Копировать';
      copyOpt.addEventListener('click', () => {
        menu.style.display = 'none';
        textInput.focus();
        document.execCommand('copy');
      });

      const pasteOpt = document.createElement('li');
      pasteOpt.className = 'context-menu-item';
      pasteOpt.innerHTML = '📥 Вставить';
      pasteOpt.addEventListener('click', () => {
        menu.style.display = 'none';
        textInput.focus();
        document.execCommand('paste');
      });

      list.appendChild(boldOpt);
      list.appendChild(italicOpt);
      list.appendChild(highlightOpt);
      list.appendChild(codeOpt);
      list.appendChild(divider);
      list.appendChild(cutOpt);
      list.appendChild(copyOpt);
      list.appendChild(pasteOpt);
    }
    
    menu.style.display = 'block';
  });
  
  // Close menu on click away
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#custom-context-menu')) {
      menu.style.display = 'none';
    }
  });
  
  // Close menu on scroll or keydown
  window.addEventListener('scroll', () => {
    menu.style.display = 'none';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      menu.style.display = 'none';
    }
  });
}
