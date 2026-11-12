// CANssm preload: a minimal, safe bridge for local file dialogs
const { contextBridge, ipcRenderer } = require('electron');
let beforeClose = null;
contextBridge.exposeInMainWorld('canssmNative', {
  openFile: (exts) => ipcRenderer.invoke('open-file', exts),
  saveFile: (opts) => ipcRenderer.invoke('save-file', { name: opts.name, ext: opts.ext, bytes: Array.from(opts.bytes), path: opts.path }),
  onBeforeClose: (fn) => { beforeClose = fn; }
});
contextBridge.exposeInMainWorld('__canssmBeforeClose', () => (beforeClose ? beforeClose() : true));
