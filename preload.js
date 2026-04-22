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
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),

  // ── 작업(Job) 관리 ──
  jobs: {
    list: (date, vendor) => ipcRenderer.invoke('jobs:list', date, vendor),
    listMonth: (year, month, vendor) => ipcRenderer.invoke('jobs:listMonth', year, month, vendor),
    listFiles: (date, vendor, sequence) => ipcRenderer.invoke('jobs:listFiles', date, vendor, sequence),
    recordUpload: (date, vendor, sequence) => ipcRenderer.invoke('jobs:recordUpload', date, vendor, sequence),
    deleteUploadHistory: (date, vendor, sequence, timestamp) =>
      ipcRenderer.invoke('jobs:deleteUploadHistory', date, vendor, sequence, timestamp),
    loadManifest: (date, vendor, sequence) => ipcRenderer.invoke('jobs:loadManifest', date, vendor, sequence),
    create: (date, vendor, opts) => ipcRenderer.invoke('jobs:create', date, vendor, opts),
    updateManifest: (date, vendor, sequence, patch) => ipcRenderer.invoke('jobs:updateManifest', date, vendor, sequence, patch),
    complete: (date, vendor, sequence) => ipcRenderer.invoke('jobs:complete', date, vendor, sequence),
    delete: (date, vendor, sequence) => ipcRenderer.invoke('jobs:delete', date, vendor, sequence),
  },

  // ── 파일 I/O ──
  getDataDir: () => ipcRenderer.invoke('file:getDataDir'),
  fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, buffer) => ipcRenderer.invoke('file:write', filePath, buffer),
  saveFileAs: (srcPath, defaultName) => ipcRenderer.invoke('file:saveAs', srcPath, defaultName),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('file:showInFolder', targetPath),
  openPath: (targetPath) => ipcRenderer.invoke('file:openPath', targetPath),
  listVendorFiles: (vendorId) => ipcRenderer.invoke('file:listVendorFiles', vendorId),
  resolveVendorPath: (fileName) => ipcRenderer.invoke('file:resolveVendorPath', fileName),
  resolveJobPath: (date, vendor, sequence, fileName) =>
    ipcRenderer.invoke('file:resolveJobPath', date, vendor, sequence, fileName),

  // ── Python subprocess ──
  runPython: (scriptName, args) => ipcRenderer.invoke('python:run', scriptName, args),
  cancelPython: () => ipcRenderer.invoke('python:cancel'),
  pythonStatus: () => ipcRenderer.invoke('python:status'),
  detectPythonPath: () => ipcRenderer.invoke('python:detectPath'),

  // ── 자격증명·세션 관리 ──
  checkCredentials: (vendorId) => ipcRenderer.invoke('credentials:check', vendorId),
  saveCredentials: (vendorId, id, password) =>
    ipcRenderer.invoke('credentials:save', vendorId, id, password),
  deleteCredentials: (vendorId) => ipcRenderer.invoke('credentials:delete', vendorId),
  checkSession: () => ipcRenderer.invoke('session:check'),

  // ── 재고조정 서브 창 ──
  stockAdjust: {
    open: (date, vendor, sequence) => ipcRenderer.invoke('stockAdjust:open', date, vendor, sequence),
    close: () => ipcRenderer.invoke('stockAdjust:close'),
    load: (date, vendor, sequence) => ipcRenderer.invoke('stockAdjust:load', date, vendor, sequence),
    save: (date, vendor, sequence, patches) =>
      ipcRenderer.invoke('stockAdjust:save', date, vendor, sequence, patches),
    getLocks: () => ipcRenderer.invoke('stockAdjust:getLocks'),
    onLocksChanged: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('stock-adjust:locks-changed', handler);
      return () => ipcRenderer.removeListener('stock-adjust:locks-changed', handler);
    },
  },

  // ── 발주확정서 부분 패치 ──
  confirmation: {
    patchQuantities: (date, vendor, sequence, patches) =>
      ipcRenderer.invoke('confirmation:patchQuantities', date, vendor, sequence, patches),
  },

  // ── 운송 분배 서브 창 ──
  transport: {
    open: (date, vendor, sequence) => ipcRenderer.invoke('transport:open', date, vendor, sequence),
    close: () => ipcRenderer.invoke('transport:close'),
    load: (date, vendor, sequence) => ipcRenderer.invoke('transport:load', date, vendor, sequence),
    save: (date, vendor, sequence, assignments) =>
      ipcRenderer.invoke('transport:save', date, vendor, sequence, assignments),
  },

  // ── 웹 뷰 (WebContentsView) ──
  webview: {
    setVendor: (vendorId) => ipcRenderer.invoke('webview:setVendor', vendorId),
    setBounds: (bounds) => ipcRenderer.invoke('webview:setBounds', bounds),
    setVisible: (visible) => ipcRenderer.invoke('webview:setVisible', visible),
    navigate: (url) => ipcRenderer.invoke('webview:navigate', url),
    reload: () => ipcRenderer.invoke('webview:reload'),
    getUrl: () => ipcRenderer.invoke('webview:getUrl'),
    onUrlChanged: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('webview:url-changed', handler);
      return () => ipcRenderer.removeListener('webview:url-changed', handler);
    },
  },

  // ── 찾기 (Ctrl+F) ──
  find: {
    query: (target, text, options) =>
      ipcRenderer.invoke('find:query', { target, text, options }),
    close: (target) =>
      ipcRenderer.invoke('find:close', { target }),
    onOpen: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('find:open', handler);
      return () => ipcRenderer.removeListener('find:open', handler);
    },
    onResult: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('find:result', handler);
      return () => ipcRenderer.removeListener('find:result', handler);
    },
  },

  // ── 플러그인 전용 IPC ──
  //   renderer 의 ctx.ipcInvoke('<channel>', ...) 가 이걸 거쳐
  //   main 의 'plugin:<pluginId>:<channel>' 핸들러로 디스패치.
  //   채널 이름은 pluginId 프리픽스로 네임스페이스 분리.
  invokePluginChannel: (pluginId, channel, ...args) => {
    if (typeof pluginId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,29}$/.test(pluginId)) {
      return Promise.reject(new Error(`invalid pluginId: ${pluginId}`));
    }
    if (typeof channel !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,59}$/i.test(channel)) {
      return Promise.reject(new Error(`invalid channel: ${channel}`));
    }
    return ipcRenderer.invoke(`plugin:${pluginId}:${channel}`, ...args);
  },

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
