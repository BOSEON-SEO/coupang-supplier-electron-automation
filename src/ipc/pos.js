// pos:* IPC — PO 풀 (ALL_POS) 백엔드.
// pos:refresh 는 python po_download.py 호출 + 결과 xlsx 파싱 후 DB upsert.
// (M3 에서 PoListView 가 실제로 호출. M2 에선 핸들러 등록까지만)
const { ipcMain } = require('electron');
const posRepo = require('../db/repos/pos');

function register() {
  ipcMain.handle('pos:listAll', (_e, vendorId) => {
    if (!vendorId) return { success: false, error: 'vendor required' };
    return { success: true, rows: posRepo.listAll(vendorId) };
  });

  ipcMain.handle('pos:listByJob', (_e, vendorId, date, sequence) => {
    if (!vendorId || !date || sequence == null) {
      return { success: false, error: 'vendor/date/sequence required' };
    }
    return { success: true, rows: posRepo.listByJob(vendorId, date, sequence) };
  });

  ipcMain.handle('pos:listOrphans', (_e, vendorId) => {
    if (!vendorId) return { success: false, error: 'vendor required' };
    return { success: true, rows: posRepo.listOrphans(vendorId) };
  });

  ipcMain.handle('pos:assignToJob', (_e, posIds, vendorId, date, sequence) => {
    if (!Array.isArray(posIds) || posIds.length === 0) {
      return { success: false, error: 'posIds required' };
    }
    const n = posRepo.assignToJob(posIds, vendorId, date, sequence);
    return { success: true, assigned: n };
  });

  ipcMain.handle('pos:unassign', (_e, posIds) => {
    if (!Array.isArray(posIds) || posIds.length === 0) {
      return { success: false, error: 'posIds required' };
    }
    const n = posRepo.unassign(posIds);
    return { success: true, unassigned: n };
  });

  ipcMain.handle('pos:upsertMany', (_e, rows) => {
    if (!Array.isArray(rows)) return { success: false, error: 'rows required' };
    const n = posRepo.upsertMany(rows);
    return { success: true, count: n };
  });

  // PO 갱신 (po_number 단위 dedup) — 기존 발주번호는 skip, 신규만 추가.
  ipcMain.handle('pos:addNewOnly', (_e, vendorId, rows) => {
    if (!vendorId) return { success: false, error: 'vendor required' };
    if (!Array.isArray(rows)) return { success: false, error: 'rows required' };
    try {
      const result = posRepo.addNewOnly(vendorId, rows);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
