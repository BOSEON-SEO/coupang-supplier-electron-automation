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
    listMonthFull: (year, month, vendor) => ipcRenderer.invoke('jobs:listMonthFull', year, month, vendor),
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
    open: (date, vendor, sequence, options) => ipcRenderer.invoke('stockAdjust:open', date, vendor, sequence, options),
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

  // ── 확정수량 Cross-Sync (po.xlsx / po-tbnws.xlsx / confirmation.xlsx 동기화) ──
  //   patches: [{ key: '발주번호|물류센터|SKU바코드', confirmedQty, shortageReason? }]
  //   opts.excludeFiles: 특정 파일 skip ("방금 직접 쓴 파일" 이중 write 회피)
  //   각 파일 존재 시에만 patch. 성공 시 'job:file-updated' 이벤트 자동 broadcast.
  confirmedQty: {
    sync: (date, vendor, sequence, patches, opts) =>
      ipcRenderer.invoke('confirmedQty:sync', date, vendor, sequence, patches, opts),
  },

  // ── po-tbnws.xlsx 의 반출수량 컬럼 patch (복합키 기반) ──
  poTbnws: {
    patchFulfillExport: (date, vendor, sequence, patches) =>
      ipcRenderer.invoke('poTbnws:patchFulfillExport', date, vendor, sequence, patches),
  },

  // ── 이플렉스 반출신청 엑셀 저장 + manifest.eflexHistory 기록 ──
  eflex: {
    recordOutbound: (date, vendor, sequence, payload) =>
      ipcRenderer.invoke('eflex:recordOutbound', date, vendor, sequence, payload),
  },

  // ── 파렛트 적재리스트 xlsx 생성 (transport.json + confirmation.xlsx) ──
  //   options.companyName: 산출물의 '업체명' 칸에 들어갈 회사 정식 명칭.
  palletList: {
    generate: (date, vendor, sequence, options) =>
      ipcRenderer.invoke('palletList:generate', date, vendor, sequence, options),
  },

  // ── 투비 쿠팡반출 양식 — 외부 물류팀 협업용 양식 xlsx 생성·업로드 반영 ──
  tbnwsCoupangExport: {
    generate: (date, vendor, sequence) =>
      ipcRenderer.invoke('tbnwsCoupangExport:generate', date, vendor, sequence),
    apply: (date, vendor, sequence, fileBuffer) =>
      ipcRenderer.invoke('tbnwsCoupangExport:apply', date, vendor, sequence, fileBuffer),
    reset: (date, vendor, sequence) =>
      ipcRenderer.invoke('tbnwsCoupangExport:reset', date, vendor, sequence),
    zeroOutUnmatched: (date, vendor, sequence, keys) =>
      ipcRenderer.invoke('tbnwsCoupangExport:zeroOutUnmatched', date, vendor, sequence, keys),
  },

  // ── 작업 파일 갱신 이벤트 (confirmation/po/po-tbnws 등 자동 재로드용) ──
  //   renderer 가 해당 job·파일명 매칭되는 이벤트 받으면 현재 열린 탭 갱신.
  onJobFileUpdated: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('job:file-updated', handler);
    return () => ipcRenderer.removeListener('job:file-updated', handler);
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

  // ── 라이선스 ──
  license: {
    get: () => ipcRenderer.invoke('license:get'),
    activate: (id, serial) => ipcRenderer.invoke('license:activate', { id, serial }),
    reverify: () => ipcRenderer.invoke('license:reverify'),
    clear: () => ipcRenderer.invoke('license:clear'),
    onChanged: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('license-changed', handler);
      return () => ipcRenderer.removeListener('license-changed', handler);
    },
  },

  // ── 자동 업데이트 ──
  update: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
  },

  // ── M2 (v4) — PO 풀 / 인박스 / lot ─────────────────────────
  // ipc/* 컨트롤러가 등록한 신규 채널. M3+ 의 신규 view 가 사용.
  pos: {
    listAll: (vendorId) => ipcRenderer.invoke('pos:listAll', vendorId),
    listByJob: (vendorId, date, sequence) => ipcRenderer.invoke('pos:listByJob', vendorId, date, sequence),
    listOrphans: (vendorId) => ipcRenderer.invoke('pos:listOrphans', vendorId),
    assignToJob: (posIds, vendorId, date, sequence) =>
      ipcRenderer.invoke('pos:assignToJob', posIds, vendorId, date, sequence),
    unassign: (posIds) => ipcRenderer.invoke('pos:unassign', posIds),
    upsertMany: (rows) => ipcRenderer.invoke('pos:upsertMany', rows),
  },
  inbox: {
    list: (vendorId, kind, date, sequence) =>
      ipcRenderer.invoke('inbox:list', vendorId, kind, date, sequence),
    exclude: (ids) => ipcRenderer.invoke('inbox:exclude', ids),
    routeFromConfirm: (rows) => ipcRenderer.invoke('inbox:routeFromConfirm', rows),
  },
  lots: {
    listByJob: (vendorId, kind, date, sequence) =>
      ipcRenderer.invoke('lots:listByJob', vendorId, kind, date, sequence),
    get: (lotId) => ipcRenderer.invoke('lots:get', lotId),
    create: (payload) => ipcRenderer.invoke('lots:create', payload),
    cancel: (lotId) => ipcRenderer.invoke('lots:cancel', lotId),
    upload: (vendorId, kind, date, sequence, lotIds) =>
      ipcRenderer.invoke('lots:upload', vendorId, kind, date, sequence, lotIds),
    listUploadHistory: (vendorId, kind, date, sequence) =>
      ipcRenderer.invoke('lots:listUploadHistory', vendorId, kind, date, sequence),
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
