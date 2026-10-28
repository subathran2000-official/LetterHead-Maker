const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  listTemplates: call('templates:list'),
  loadTemplate: call('templates:load'),
  saveTemplate: call('templates:save'),
  deleteTemplate: call('templates:delete'),
  getDefault: call('default:get'),
  setDefault: call('default:set'),
  exportTemplateFile: call('templates:exportFile'),
  importPick: call('templates:importPick'),
  importUnlock: call('templates:importUnlock'),
  defaultLogo: call('logo:default'),
  pickImage: call('image:pick'),
  authStatus: call('auth:status'),
  setupPin: call('auth:setup'),
  unlock: call('auth:unlock'),
  lock: call('auth:lock'),
  changePin: call('auth:change'),
  beginPdf: call('pdf:begin'),
  finishPdf: call('pdf:finish'),
  verifyPdf: call('pdf:verify'),
  listIssued: call('registry:list'),
  about: call('app:about'),
  openWebsite: call('app:openWebsite'),
});
