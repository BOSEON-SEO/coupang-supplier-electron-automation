import React, { useEffect, useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { buildWarehouseIndex } from './coupangWarehousesSeed';

// 앱 vendor id → 한글 표시명 (제목 기본값용). RelocationModal 과 동일.
const VENDOR_LABEL = {
  coupang: '쿠팡',
  canon: '캐논',
};

/**
 * 출고예정 등록 모달.
 *
 * 백엔드: POST /api/coupang/coupangList/inbound/applyStep4Schedule?work_seq=X
 *   body 에 exportProducts[] 포함 — 각 row 는 (물류센터, 상품코드, 확정수량, 수취인 정보).
 *   백엔드의 swapExportSchedule 이 기존 export_schedule_seq 를 자동으로 교체하므로
 *   클라이언트가 별도로 삭제 호출할 필요 없음. (단일 트랜잭션)
 *
 * 소스: po-tbnws.xlsx 의 확정수량 > 0 인 행들.
 *   (물류센터, 상품코드) 단위로 합산 — 어드민과 동일하게 센터별 분할을 유지.
 *   각 row 의 물류센터 값으로 플러그인 설정의 coupangWarehouses lookup →
 *   user_contact/user_phone/user_address/receiver_name/user_name 자동 채움.
 *   lookup 실패 시 기존 기본값 fallback + 빨간 경고 (사용자가 설정에서 창고 추가하거나
 *   행을 직접 수정).
 */
export default function ExportScheduleModal({ job, onClose }) {
  const [rows, setRows] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [sending, setSending] = useState(false);
  const [pluginSettings, setPluginSettings] = useState({});

  const [title, setTitle] = useState('');
  const [exportDate, setExportDate] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!job) throw new Error('job 없음');
        const api = window.electronAPI;

        const sRes = await api.loadSettings();
        const settings = sRes?.settings?.plugins?.tbnws || {};
        if (!cancelled) setPluginSettings(settings);

        const warehouseIndex = buildWarehouseIndex(settings.coupangWarehouses);

        // 기본 제목 · 출고일 — `MMDD {벤더이름} n차`
        // 벤더 이름은 vendors.json 의 name 필드 (사용자가 설정한 표시명) 우선 사용.
        // 없으면 하드코딩 매핑 (쿠팡/캐논) → 그래도 없으면 vendor id 그대로.
        const ymd = String(job.date || '').replace(/-/g, '');
        const mmdd = ymd.slice(4, 8);
        let vendorLabel = '';
        try {
          const vRes = await api.loadVendors();
          const meta = (vRes?.vendors || []).find((v) => v.id === job.vendor);
          if (meta?.name) vendorLabel = String(meta.name).trim();
        } catch { /* 무시 */ }
        if (!vendorLabel) {
          vendorLabel = VENDOR_LABEL[String(job.vendor || '').toLowerCase()]
                     || job.vendor
                     || '';
        }
        if (!cancelled) {
          setTitle(`${mmdd} ${vendorLabel} ${job.sequence || 1}차`);
          setExportDate(job.date || '');
        }

        const resolved = await api.resolveJobPath(job.date, job.vendor, job.sequence, 'po-tbnws.xlsx');
        if (!resolved?.success) throw new Error(resolved?.error || '경로 해석 실패');
        const exists = await api.fileExists(resolved.path);
        if (!exists) {
          if (!cancelled) { setRows([]); setLoadErr('po-tbnws.xlsx 가 아직 없습니다.'); }
          return;
        }
        const read = await api.readFile(resolved.path);
        if (!read?.success) throw new Error(read?.error || '파일 읽기 실패');
        const wb = XLSX.read(read.data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (aoa.length < 2) { if (!cancelled) setRows([]); return; }
        const header = aoa[0].map((h) => String(h).trim());
        const col = (name) => header.indexOf(name);
        const idx = {
          productCode:  col('상품코드'),
          skuName:      col('SKU 이름'),
          confirmedQty: col('확정수량'),
          warehouse:    col('물류센터'),
          orderSeq:     col('발주번호'),
        };

        // (물류센터, 상품코드) 단위로 합산 + 해당 조합에 걸린 발주번호들 수집 → description.
        const groupMap = new Map();
        for (let i = 1; i < aoa.length; i += 1) {
          const r = aoa[i];
          const pc = String(r[idx.productCode] ?? '').trim();
          const center = String(r[idx.warehouse] ?? '').trim();
          const qty = Number(r[idx.confirmedQty]) || 0;
          if (!pc || qty <= 0) continue;
          const orderSeq = String(r[idx.orderSeq] ?? '').trim();
          const key = `${center}|${pc}`;
          const prev = groupMap.get(key);
          if (prev) {
            prev.ea += qty;
            if (orderSeq) prev.orderSeqs.add(orderSeq);
            continue;
          }
          const w = warehouseIndex.get(center);
          const matched = !!w;
          groupMap.set(key, {
            key,
            productCode: pc,
            productName: String(r[idx.skuName] ?? '').trim(),
            centerName:  center,
            ea: qty,
            matched,
            orderSeqs:   new Set(orderSeq ? [orderSeq] : []),
            partnerName:  settings.exportPartnerName || '쿠팡',
            userName:     matched ? w.centerName : (settings.exportReceiverName || ''),
            receiverName: matched ? w.centerName : (settings.exportReceiverName || ''),
            userPhone:    matched ? (w.contact2 || w.contact || '') : (settings.exportReceiverPhone || ''),
            userContact:  matched ? (w.contact || '') : (settings.exportReceiverContact || ''),
            userAddress:  matched ? (w.address || '') : (settings.exportReceiverAddress || ''),
            userMemo:     settings.exportReceiverMemo || '',
          });
        }
        if (!cancelled) setRows(Array.from(groupMap.values()));
      } catch (err) {
        if (!cancelled) setLoadErr(err.message || String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [job]);

  const existingSeq = job?.pluginData?.tbnws?.exportScheduleSeq;

  const totalEa = useMemo(
    () => (rows || []).reduce((s, r) => s + (Number(r.ea) || 0), 0),
    [rows],
  );

  const unmatchedCount = useMemo(
    () => (rows || []).filter((r) => !r.matched).length,
    [rows],
  );
  const unmatchedCenters = useMemo(() => {
    const set = new Set();
    (rows || []).forEach((r) => { if (!r.matched && r.centerName) set.add(r.centerName); });
    return Array.from(set);
  }, [rows]);

  const updateCell = (key, field, value) => {
    setRows((prev) => (prev || []).map((r) => (
      r.key === key ? { ...r, [field]: value } : r
    )));
  };

  const handleSubmit = async () => {
    if (!rows || rows.length === 0) return;
    const workSeq = job?.pluginData?.tbnws?.workSeq;
    if (workSeq == null) {
      alert('이 작업에 workSeq 가 없습니다.');
      return;
    }

    if (existingSeq != null) {
      const ok = window.confirm(
        `이 작업에는 이미 출고예정 #${existingSeq} 가 등록되어 있습니다.\n`
        + '새로 전송하면 백엔드가 기존 건을 자동으로 교체합니다. 계속하시겠습니까?',
      );
      if (!ok) return;
    }

    setSending(true);
    try {
      const body = {
        export_date: exportDate || job.date,
        export_schedule_title: title,
        export_num: 0,
        send_sms: 'N',
        is_export_schedule: 'Y',
        exportProducts: rows.map((r) => ({
          partner_name:   r.partnerName,
          category_code:  pluginSettings.exportCategoryCode || 'B',
          user_name:      r.userName,
          receiver_name:  r.receiverName,
          user_contact:   r.userContact,
          user_phone:     r.userPhone,
          user_address:   r.userAddress,
          user_memo:      r.userMemo,
          goods_name:     r.productName || r.productCode,
          ea:             Number(r.ea) || 0,
          description:    r.orderSeqs ? Array.from(r.orderSeqs).join(', ') : '',
          product_code:   r.productCode,
          option_code:    '',
        })),
      };

      const res = await window.electronAPI.invokePluginChannel(
        'tbnws', 'export.applyStep4Schedule',
        { workSeq, body },
      );
      if (!res?.success) {
        alert(`출고예정 등록 실패: ${res?.error || 'unknown'}`);
        return;
      }
      const newSeq = res.exportScheduleSeq;

      if (res.testMode) {
        console.info('[tbnws/exportSchedule TEST MODE] url:', res.url, '\nbody:', res.body);
        alert(
          `[테스트 모드] 실제 전송 안 함 — 요청 body 는 DevTools Console 에 로그됨.\n\n`
          + `URL: ${res.url}\n`
          + `${rows.length}행 · 총 ${totalEa}ea\n\n`
          + `설정에서 '출고예정 테스트 모드' 체크 해제하면 실전송으로 전환됩니다.`,
        );
        onClose();
        return;
      }

      // manifest history 기록
      try {
        const prev = (job.pluginData && job.pluginData.tbnws) || {};
        const prevHistory = Array.isArray(prev.exportScheduleHistory) ? prev.exportScheduleHistory : [];
        const entry = {
          timestamp: new Date().toISOString(),
          exportScheduleSeq: newSeq,
          title,
          exportDate: body.export_date,
          exportProducts: body.exportProducts,
          totalEa,
        };
        await window.electronAPI.jobs.updateManifest(
          job.date, job.vendor, job.sequence,
          {
            pluginData: {
              ...(job.pluginData || {}),
              tbnws: {
                ...prev,
                exportScheduleSeq: newSeq,
                exportScheduleHistory: [...prevHistory, entry],
              },
            },
          },
        );
        window.dispatchEvent(new Event('job:reload'));
      } catch (err) {
        console.warn('[tbnws] export schedule history 기록 실패', err);
      }

      alert(`출고예정 등록 완료 — exportScheduleSeq=${newSeq} (${rows.length}행, 총 ${totalEa}ea)`);
      onClose();
    } catch (err) {
      alert(`전송 실패: ${err?.message || err}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="eflex-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="eflex-overlay__card" onClick={(e) => e.stopPropagation()}>
        <header className="eflex-overlay__header">
          <h3 className="eflex-overlay__title">
            📅 출고예정 등록
            {rows && <span className="eflex-overlay__count">· {rows.length}행 · 총 {totalEa}ea</span>}
            {existingSeq != null && (
              <span className="eflex-overlay__count" style={{ color: '#b59200' }}>
                · ⚠ 기존 #{existingSeq} 등록됨
              </span>
            )}
          </h3>
          <button type="button" className="eflex-overlay__close" onClick={onClose}>×</button>
        </header>

        <div className="eflex-overlay__body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--color-text-muted)' }}>제목</div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--color-text-muted)' }}>출고일</div>
              <input
                type="date"
                value={exportDate}
                onChange={(e) => setExportDate(e.target.value)}
                style={{ width: '100%' }}
              />
            </label>
          </div>

          {unmatchedCount > 0 && (
            <div
              role="alert"
              style={{
                background: '#fdecea',
                border: '1px solid #f5c2c7',
                color: '#842029',
                padding: '8px 10px',
                borderRadius: 4,
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              ⚠ <b>{unmatchedCount}행</b>의 물류센터가 창고 목록에 없습니다:
              {' '}<code>{unmatchedCenters.join(', ')}</code>
              <br />
              → 플러그인 설정 → <b>쿠팡 창고 관리</b>에서 해당 센터를 추가하거나, 아래 표에서 해당 행을 직접 수정 후 전송하세요.
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            (물류센터, 상품코드) 단위로 합산. 수취인 정보는 창고 목록에서 자동 매칭 — 행별로 수정 가능.
          </div>

          {loadErr ? (
            <p className="eflex-overlay__empty">{loadErr}</p>
          ) : rows === null ? (
            <p className="eflex-overlay__empty">불러오는 중…</p>
          ) : rows.length === 0 ? (
            <p className="eflex-overlay__empty">
              확정수량 &gt; 0 인 행이 없습니다.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="eflex-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 110 }}>물류센터</th>
                    <th style={{ minWidth: 170 }}>상품코드</th>
                    <th style={{ minWidth: 400 }}>상품명</th>
                    <th className="num" style={{ minWidth: 80 }}>수량</th>
                    <th style={{ minWidth: 120 }}>고객명</th>
                    <th style={{ minWidth: 140 }}>수취인명</th>
                    <th style={{ minWidth: 130 }}>연락처</th>
                    <th style={{ minWidth: 170 }}>이메일</th>
                    <th style={{ minWidth: 400 }}>주소</th>
                    <th style={{ minWidth: 260 }}>배송메모</th>
                    <th style={{ minWidth: 100 }}>파트너명</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.key}
                      style={!r.matched ? { background: '#fdecea' } : undefined}
                      title={!r.matched ? '창고 목록에 이 센터명이 없어 기본값이 적용되었습니다.' : undefined}
                    >
                      <td>
                        {r.matched ? (
                          <code>{r.centerName || '(없음)'}</code>
                        ) : (
                          <span style={{ color: '#842029' }}>
                            ⚠ <code>{r.centerName || '(없음)'}</code>
                          </span>
                        )}
                      </td>
                      <td><code>{r.productCode}</code></td>
                      <td>
                        <input
                          type="text"
                          value={r.productName}
                          onChange={(e) => updateCell(r.key, 'productName', e.target.value)}
                          style={{ width: '100%', minWidth: 140 }}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          value={r.ea}
                          onChange={(e) => updateCell(r.key, 'ea', e.target.value)}
                          style={{ width: 70, textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.userName}
                          onChange={(e) => updateCell(r.key, 'userName', e.target.value)}
                          style={{ width: '100%', minWidth: 110 }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.receiverName}
                          onChange={(e) => updateCell(r.key, 'receiverName', e.target.value)}
                          style={{ width: '100%', minWidth: 130 }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.userPhone}
                          onChange={(e) => updateCell(r.key, 'userPhone', e.target.value)}
                          style={{ width: '100%', minWidth: 110 }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.userContact}
                          onChange={(e) => updateCell(r.key, 'userContact', e.target.value)}
                          style={{ width: '100%', minWidth: 150 }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.userAddress}
                          onChange={(e) => updateCell(r.key, 'userAddress', e.target.value)}
                          style={{ width: '100%', minWidth: 220 }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.userMemo}
                          onChange={(e) => updateCell(r.key, 'userMemo', e.target.value)}
                          style={{ width: '100%', minWidth: 100 }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.partnerName}
                          onChange={(e) => updateCell(r.key, 'partnerName', e.target.value)}
                          style={{ width: '100%', minWidth: 80 }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="eflex-overlay__footer">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            disabled={sending}
          >
            취소
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={handleSubmit}
            disabled={sending || !rows?.length}
          >
            📅 {sending ? '전송 중…' : `출고예정 등록 (${rows?.length || 0}행)`}
          </button>
        </footer>
      </div>
    </div>
  );
}
