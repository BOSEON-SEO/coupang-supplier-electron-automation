const { contextBridge, ipcRenderer } = require('electron');

/**
 * 보안 컨텍스트 브릿지
 * - contextIsolation: true 상태에서 Renderer가 Main에 접근하는 유일한 경로
 * - 노출 API는 최소 권한 원칙으로 설계
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ── 벤더 관리 ──
  loadVendors: () => ipcRenderer.invoke('vendors:load'),
  saveVendors: (data) => ipcRenderer.invoke('vendors:save', data),

  // ── 파일 I/O ──
  getDataDir: () => ipcRenderer.invoke('file:getDataDir'),
  fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, buffer) => ipcRenderer.invoke('file:write', filePath, buffer),
  listVendorFiles: (vendorId) => ipcRenderer.invoke('file:listVendorFiles', vendorId),
  resolveVendorPath: (fileName) => ipcRenderer.invoke('file:resolveVendorPath', fileName),

  // ── Python subprocess ──
  runPython: (scriptName, args) => ipcRenderer.invoke('python:run', scriptName, args),
  cancelPython: () => ipcRenderer.invoke('python:cancel'),
  pythonStatus: () => ipcRenderer.invoke('python:status'),
  detectPythonPath: () => ipcRenderer.invoke('python:detectPath'),

  // ── 자격증명·세션 관리 ──
  checkCredentials: (vendorId) => ipcRenderer.invoke('credentials:check', vendorId),
  checkSession: () => ipcRenderer.invoke('session:check'),

  // ── 위험 동작 ──
  confirmDangerous: (actionName) => ipcRenderer.invoke('action:confirmDangerous', actionName),

  // ── 이벤트 리스너 (Main → Renderer) ──
  onCountdown: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('action:countdown', handler);
    return () => ipcRenderer.removeListener('action:countdown', handler);
  },

  onPythonLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('python:log', handler);
    return () => ipcRenderer.removeListener('python:log', handler);
  },

  onPythonError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('python:error', handler);
    return () => ipcRenderer.removeListener('python:error', handler);
  },

  onPythonDone: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('python:done', handler);
    return () => ipcRenderer.removeListener('python:done', handler);
  },
});
