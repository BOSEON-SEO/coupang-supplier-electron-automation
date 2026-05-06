// lots:* IPC — lot 생성·취소·업로드.
// lots:upload 는 M5 에서 python shipment_register/milkrun_register 와 결합. 현재는 mark + history.
const { ipcMain } = require('electron');
const lotsRepo = require('../db/repos/lots');
const uploadsRepo = require('../db/repos/uploads');

function register() {
  ipcMain.handle('lots:listByJob', (_e, vendorId, kind, date, sequence) => {
    if (!vendorId || !kind || !date || sequence == null) {
      return { success: false, error: 'vendor/kind/date/sequence required' };
    }
    return { success: true, rows: lotsRepo.listByJob(vendorId, kind, date, sequence) };
  });

  ipcMain.handle('lots:get', (_e, lotId) => {
    if (!lotId) return { success: false, error: 'lotId required' };
    const l = lotsRepo.get(lotId);
    return l ? { success: true, lot: l } : { success: false, error: 'not found' };
  });

  ipcMain.handle('lots:create', (_e, payload) => {
    try {
      const id = lotsRepo.create(payload);
      return { success: true, id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('lots:cancel', (_e, lotId) => {
    try {
      const ok = lotsRepo.cancel(lotId);
      return { success: ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // M5 에서 python register 와 결합. 현재는 단순 표시 + history 기록.
  ipcMain.handle('lots:upload', (_e, vendorId, kind, date, sequence, lotIds) => {
    if (!Array.isArray(lotIds) || lotIds.length === 0) {
      return { success: false, error: 'lotIds required' };
    }
    const lots = lotIds.map((id) => lotsRepo.get(id)).filter(Boolean);
    const totalQty = lots.reduce((s, l) => s + (l.total_qty || 0), 0);
    lotsRepo.markUploaded(lotIds);
    uploadsRepo.add({ vendor_id: vendorId, kind, date, sequence, lotIds, total_qty: totalQty });
    return { success: true, uploadedCount: lotIds.length, totalQty };
  });

  ipcMain.handle('lots:listUploadHistory', (_e, vendorId, kind, date, sequence) => {
    if (!vendorId || !kind || !date || sequence == null) {
      return { success: false, error: 'vendor/kind/date/sequence required' };
    }
    return { success: true, rows: uploadsRepo.listByJob(vendorId, kind, date, sequence) };
  });
}

module.exports = { register };
