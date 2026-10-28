const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Vault, exportShared, importShared } = require('./lib/vault');
const { buildPdf, newDocId } = require('./lib/exporter');

// Keep the data folder from before the rename so saved templates, PIN and register still load
// LETTERHEAD_DATA_DIR lets tests run against a throwaway folder instead of the real data
app.setPath('userData', process.env.LETTERHEAD_DATA_DIR || path.join(app.getPath('appData'), 'Brooklin Letterhead Studio'));

const WEBSITE = 'https://www.akvisionsystems.com/';

let win;
let vault;
let registryFile;
let settingsFile;
let unlocked = false;


const readRegistry = () => { try { return JSON.parse(fs.readFileSync(registryFile, 'utf8')); } catch { return []; } };
const writeRegistry = (r) => fs.writeFileSync(registryFile, JSON.stringify(r, null, 2));
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } };
const writeSettings = (s) => fs.writeFileSync(settingsFile, JSON.stringify(s));
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const pinMatches = (pin, st) => !!st.pinHash &&
  crypto.timingSafeEqual(Buffer.from(hashPin(pin, st.pinSalt), 'hex'), Buffer.from(st.pinHash, 'hex'));
const validPin = (pin) => { if (!/^\d{4,8}$/.test(String(pin))) throw new Error('PIN must be 4–8 digits'); };
const safeName = (s, fallback) => (String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || fallback).slice(0, 80);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 20;

// Brute-force protection: after 5 wrong PINs, wait 30s (doubling each time)
let failedAttempts = 0;
let lockedUntil = 0;

// Every data handler requires the app to be unlocked with the PIN first
function secure(channel, fn) {
  ipcMain.handle(channel, (...args) => {
    if (!unlocked) throw new Error('App is locked');
    return fn(...args);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    title: 'Letterhead Maker',
    icon: path.join(__dirname, '..', 'assets', 'letterhead-maker-icon.png'),
    backgroundColor: '#F2F6FA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (app.isPackaged) Menu.setApplicationMenu(null);
  // Ask before closing with unsaved changes
  let closing = false;
  win.on('close', async (e) => {
    if (closing) return;
    e.preventDefault();
    const dirty = await win.webContents.executeJavaScript('typeof dirty !== "undefined" && dirty').catch(() => false);
    if (dirty) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', buttons: ['Discard changes', 'Cancel'], defaultId: 1, cancelId: 1,
        message: 'You have unsaved changes. Close anyway?',
      });
      if (response === 1) return;
    }
    closing = true;
    win.close();
  });
  // The app never navigates away or opens its own windows; links go to the default browser
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  // Templates are encrypted with a random key unique to this install. The key itself is
  // wrapped by Windows (DPAPI) so it only opens for this Windows user on this PC.
  const keyStore = {
    protect: (key) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key.toString('base64')) : key),
    unprotect: (blob) => (blob.length === 32 ? blob : Buffer.from(safeStorage.decryptString(blob), 'base64')),
  };
  try {
    vault = new Vault(path.join(app.getPath('userData'), 'templates'), path.join(app.getPath('userData'), 'vault.key'), keyStore);
    vault.migrate(); // upgrades templates saved by older versions
  } catch (e) {
    dialog.showErrorBox('Letterhead Maker', `Your saved templates cannot be unlocked on this Windows account.\n\n${e.message}`);
    app.quit();
    return;
  }
  registryFile = path.join(app.getPath('userData'), 'issued-documents.json');
  settingsFile = path.join(app.getPath('userData'), 'settings.json');

  // The page may read the installed font list; nothing else needs a permission
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'local-fonts'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'local-fonts');

  // About / website link. The address is fixed here so the page cannot open anything else.
  ipcMain.handle('app:about', () => ({ version: app.getVersion(), website: WEBSITE }));
  ipcMain.handle('app:openWebsite', () => shell.openExternal(WEBSITE));

  ipcMain.handle('auth:status', () => ({ hasPin: !!readSettings().pinHash, unlocked }));
  ipcMain.handle('auth:setup', (_e, pin) => {
    if (readSettings().pinHash) throw new Error('PIN already set');
    validPin(pin);
    const salt = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), pinSalt: salt, pinHash: hashPin(pin, salt) }));
    return (unlocked = true);
  });
  ipcMain.handle('auth:unlock', (_e, pin) => {
    const wait = Math.ceil((lockedUntil - Date.now()) / 1000);
    if (wait > 0) throw new Error(`Too many attempts — try again in ${wait}s`);
    if (pinMatches(pin, readSettings())) {
      failedAttempts = 0;
      return (unlocked = true);
    }
    failedAttempts++;
    if (failedAttempts >= 5) lockedUntil = Date.now() + 30000 * 2 ** (failedAttempts - 5);
    return (unlocked = false);
  });
  ipcMain.handle('auth:lock', () => { unlocked = false; });
  secure('auth:change', (_e, oldPin, newPin) => {
    const st = readSettings();
    if (!pinMatches(oldPin, st)) throw new Error('Current PIN is wrong');
    validPin(newPin);
    const salt = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(settingsFile, JSON.stringify({ ...st, pinSalt: salt, pinHash: hashPin(newPin, salt) }));
    return true;
  });

  secure('templates:list', () => vault.list());
  secure('templates:load', (_e, id) => vault.load(id));
  secure('templates:save', (_e, t) => vault.save(t));
  secure('templates:delete', (_e, id) => {
    vault.remove(id);
    const st = readSettings();
    if (st.defaultId === id) { delete st.defaultId; writeSettings(st); }
  });

  // The user's default letterhead: opened on every launch and used as the base for new letters
  secure('default:get', () => { const id = readSettings().defaultId; return id && vault.has(id) ? id : null; });
  secure('default:set', (_e, id) => {
    if (!vault.has(id)) throw new Error('That template no longer exists');
    writeSettings({ ...readSettings(), defaultId: id });
    return id;
  });

  secure('logo:default', () =>
    'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', 'letterhead-maker-logo.png')).toString('base64'));

  secure('image:pick', async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    const f = r.filePaths[0];
    if (fs.statSync(f).size > MAX_IMAGE_BYTES) throw new Error('Image is larger than 5 MB — please use a smaller file');
    const mime = f.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`;
  });

  // Share templates between machines as password-protected .blt files
  secure('templates:exportFile', async (_e, t, password) => {
    const data = exportShared(t, password); // checks the password before any dialog opens
    const r = await dialog.showSaveDialog(win, { defaultPath: `${safeName(t.name, 'template')}.blt`, filters: [{ name: 'Letterhead Maker Template', extensions: ['blt'] }] });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, data);
    return true;
  });
  // Import is two steps because the password is only asked for once the file is known to need one
  let pendingImport = null;
  const finishImport = (res) => {
    const t = res.template;
    t.id = crypto.randomUUID();
    pendingImport = null;
    return { template: vault.save(t) };
  };
  secure('templates:importPick', async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Letterhead Maker Template', extensions: ['blt'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    pendingImport = fs.readFileSync(r.filePaths[0]);
    const res = importShared(pendingImport);
    return res.needsPassword ? { needsPassword: true } : finishImport(res);
  });
  secure('templates:importUnlock', (_e, password) => {
    if (!pendingImport) throw new Error('No import in progress');
    return finishImport(importShared(pendingImport, password));
  });

  // Export is two steps: main picks the file and issues a Doc ID, the window
  // rasterises the pages with that ID stamped on, then main builds the locked PDF.
  let pending = null;
  secure('pdf:begin', async (_e, t) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: `${safeName(t.name, 'letterhead')}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled) return null;
    pending = { docId: newDocId(), filePath: r.filePath };
    return pending.docId;
  });
  secure('pdf:finish', async (_e, t, docId, pngPages) => {
    if (!pending || pending.docId !== docId) throw new Error('No export in progress');
    if (!Array.isArray(pngPages) || pngPages.length > MAX_PAGES) throw new Error(`A document can have at most ${MAX_PAGES} pages`);
    const { filePath } = pending;
    pending = null;
    const { bytes, sha256, pages } = await buildPdf(t, docId, pngPages);
    fs.writeFileSync(filePath, bytes);
    const reg = readRegistry();
    reg.unshift({ docId, sha256, file: path.basename(filePath), template: t.name, pages, issuedAt: new Date().toISOString() });
    writeRegistry(reg);
    shell.showItemInFolder(filePath);
    return { docId, pages, file: filePath };
  });

  secure('pdf:verify', async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(r.filePaths[0])).digest('hex');
    const match = readRegistry().find((d) => d.sha256 === hash);
    return { file: path.basename(r.filePaths[0]), match: match || null };
  });

  secure('registry:list', () => readRegistry());

  createWindow();
});

app.on('window-all-closed', () => app.quit());
