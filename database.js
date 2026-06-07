const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const getDbPath = () => {
  // Safe default for testing if app is not ready/initialized
  try {
    return path.join(app.getPath('userData'), 'db.json');
  } catch (e) {
    return path.join(process.cwd(), 'db.json');
  }
};

const getDefaultData = () => ({
  folders: [
    { id: 'inbox', name: 'Входящие', color: '#3b82f6', icon: '📥' },
    { id: 'work', name: 'Работа', color: '#f97316', icon: '💼' },
    { id: 'personal', name: 'Личное', color: '#10b981', icon: '👤' }
  ],
  items: [],
  tags: [
    { id: 't1', name: 'Звонок', color: '#8b5cf6', subtags: ['Договорились', 'Перезвонить', 'Спам'] },
    { id: 't2', name: 'Встреча', color: '#ec4899', subtags: ['Клиент', 'Команда', 'Личная'] },
    { id: 't3', name: 'Срочно', color: '#ef4444', subtags: ['ASAP', 'Сегодня', 'До конца недели'] }
  ],
  outcomes: [
    { id: 'o1', name: 'Согласие', color: '#10b981' },
    { id: 'o2', name: 'Отказ', color: '#ef4444' },
    { id: 'o3', name: 'Думает', color: '#eab308' },
    { id: 'o4', name: 'Не дозвонился', color: '#6b7280' }
  ],
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
});

// Load DB
function loadDatabase() {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    const defaultData = getDefaultData();
    saveDatabase(defaultData);
    return defaultData;
  }

  try {
    const data = fs.readFileSync(dbPath, 'utf8');
    const parsed = JSON.parse(data);

    const defaults = getDefaultData();
    return {
      folders: parsed.folders || defaults.folders,
      items: parsed.items || defaults.items,
      tags: parsed.tags || defaults.tags,
      outcomes: parsed.outcomes || defaults.outcomes,
      settings: {
        keybindings: { ...defaults.settings.keybindings, ...(parsed.settings && parsed.settings.keybindings) },
        telegram: { ...defaults.settings.telegram, ...(parsed.settings && parsed.settings.telegram) },
        system: { ...defaults.settings.system, ...(parsed.settings && parsed.settings.system) }
      }
    };
  } catch (error) {
    console.error('Error loading database, returning default:', error);
    return getDefaultData();
  }
}

// Save DB (Atomic write)
function saveDatabase(data) {
  const dbPath = getDbPath();
  const tempPath = dbPath + '.tmp';
  
  try {
    // Ensure dir exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, dbPath);
    return true;
  } catch (error) {
    console.error('Error saving database:', error);
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    return false;
  }
}

// Export DB to custom file path
function exportDatabase(destPath) {
  try {
    const dbPath = getDbPath();
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, destPath);
      return { success: true };
    }
    return { success: false, error: 'Database file does not exist yet.' };
  } catch (error) {
    console.error('Export error:', error);
    return { success: false, error: error.message };
  }
}

// Import DB from custom file path
function importDatabase(srcPath) {
  try {
    const data = fs.readFileSync(srcPath, 'utf8');
    const parsed = JSON.parse(data);
    
    // Quick validation
    if (!parsed.folders || !parsed.settings) {
      throw new Error('Invalid database format: missing required fields');
    }
    
    // Save to active DB
    saveDatabase(parsed);
    return { success: true, data: parsed };
  } catch (error) {
    console.error('Import error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getDbPath,
  loadDatabase,
  saveDatabase,
  exportDatabase,
  importDatabase
};
