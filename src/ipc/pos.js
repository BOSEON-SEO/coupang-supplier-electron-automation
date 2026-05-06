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

  // pos:refresh — M3 에서 python po_download 호출 + xlsx parse 후 upsert 추가 예정
  // 현재는 단순 upsert API 만 노출 (테스트/마이그레이션 용)
  ipcMain.handle('pos:upsertMany', (_e, rows) => {
    if (!Array.isArray(rows)) return { success: false, error: 'rows required' };
    const n = posRepo.upsertMany(rows);
    return { success: true, count: n };
  });
}

module.exports = { register };
