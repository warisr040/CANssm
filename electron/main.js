// CANssm – Electron main process (offline desktop shell)
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

const FILTERS = {
  canssm: [{ name: 'CANssm project', extensions: ['canssm'] }, { name: 'JSON', extensions: ['json'] }],
  json: [{ name: 'JSON', extensions: ['json'] }],
  dbc: [{ name: 'DBC database', extensions: ['dbc'] }],
  arxml: [{ name: 'AUTOSAR XML', extensions: ['arxml', 'xml'] }],
  xml: [{ name: 'AUTOSAR XML', extensions: ['arxml', 'xml'] }],
  xlsx: [{ name: 'Excel workbook', extensions: ['xlsx', 'xls'] }],
  xls: [{ name: 'Excel workbook', extensions: ['xlsx', 'xls'] }],
  a2l: [{ name: 'ASAM MCD-2 MC (A2L)', extensions: ['a2l'] }]
};
let win = null, forceClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1100, minHeight: 680, show: false, backgroundColor: '#0f141b',
    title: 'CANssm', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // no navigation away, no new windows, no network
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.control && input.code === 'Equal') win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
    if (input.type === 'keyDown' && input.control && input.code === 'Minus') win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
    if (input.type === 'keyDown' && input.control && input.code === 'Digit0') win.webContents.setZoomLevel(0);
  });
  win.on('close', async (e) => {
    if (forceClose) return;
    e.preventDefault();
    let ok = true;
    try { ok = await win.webContents.executeJavaScript('window.__canssmBeforeClose ? window.__canssmBeforeClose() : true'); } catch (err) { ok = true; }
    if (ok) { forceClose = true; win.close(); }
  });
}

ipcMain.handle('open-file', async (e, exts) => {
  const filters = [];
  (exts || []).forEach(x => (FILTERS[x] || [{ name: x.toUpperCase(), extensions: [x] }]).forEach(f => { if (!filters.some(g => g.name === f.name)) filters.push(f); }));
  filters.push({ name: 'All files', extensions: ['*'] });
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { path: p, name: path.basename(p), bytes: fs.readFileSync(p) };
});

ipcMain.handle('save-file', async (e, { name, ext, bytes, path: target }) => {
  let p = target;
  if (!p) {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: (FILTERS[ext] || []).concat([{ name: 'All files', extensions: ['*'] }]) });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath;
  }
  if (fs.existsSync(p)) { try { fs.copyFileSync(p, p + '.bak'); } catch (err) { /* ignore */ } }
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
});

// block every network request except local files / devtools
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|devtools|data|blob):/i.test(d.url) }));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('web-contents-created', (e, wc) => wc.on('will-attach-webview', (ev) => ev.preventDefault()));
void shell;
