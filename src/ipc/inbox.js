// inbox:* IPC — 차수별 ship/milk 미배정 풀.
// list / exclude / restore / routeFromConfirm.
const { ipcMain } = require('electron');
const inboxRepo = require('../db/repos/inbox');

function register() {
  ipcMain.handle('inbox:list', (_e, vendorId, kind, date, sequence) => {
    if (!vendorId || !kind || !date || sequence == null) {
      return { success: false, error: 'vendor/kind/date/sequence required' };
    }
    return { success: true, rows: inboxRepo.list(vendorId, kind, date, sequence) };
  });

  ipcMain.handle('inbox:exclude', (_e, ids) => {
    if (!Array.isArray(ids)) return { success: false, error: 'ids required' };
    const n = inboxRepo.removeMany(ids);
    return { success: true, removed: n };
  });

  // 확정 업로드 직후 ship/milk 로 fan-out — M5 에서 ConfirmStep upload 핸들러가 호출
  ipcMain.handle('inbox:routeFromConfirm', (_e, rows) => {
    if (!Array.isArray(rows)) return { success: false, error: 'rows required' };
    const n = inboxRepo.add(rows);
    return { success: true, added: n };
  });
}

module.exports = { register };
