import React, { useEffect, useState, useMemo } from 'react';
import * as XLSX from 'xlsx';

// 재고이동 대상 창고 태그 옵션 — 백엔드 tag 값 기준 라벨.
// 나중에 창고가 늘어나면 여기에 추가.
const WAREHOUSE_OPTIONS = [
  { value: 'GJ', label: '풀필먼트 곤지암' },
  { value: 'GT', label: '지티창고' },
];

// 앱 vendor id → 한글 표시명 (제목 기본값용)
const VENDOR_LABEL = {
  coupang: '쿠팡',
  canon: '캐논',
};

/**
 * 재고이동(로케이션 이동) 모달.
 *
 * po-tbnws.xlsx 를 읽어 반출수량 > 0 인 행만 상품코드별 합산해 items 생성.
 * 사용자는 title/설명/From·To 창고 태그만 확인/수정하고 전송.
 *
 * 백엔드: POST /api/wms/operateRelocation
 *   body: { title, description, fromWarehouseTag, toWarehouseTag, items:[{productCode, ea}] }
 *
 * 재등록: 이미 relocation_seq 가 있으면 handler 에서 confirm 받고 기존 삭제 → 새로 등록.
 */
export default function RelocationModal({ job, onClose }) {
  const [rows, setRows] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [sending, setSending] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fromTag, setFromTag] = useState('');
  const [toTag, setToTag] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!job) throw new Error('job 없음');
        const api = window.electronAPI;

        // 기본 창고 태그 — 설정값이 옵션 목록에 있으면 그걸 쓰고 아니면 GJ/GT.
        const sRes = await api.loadSettings();
        const pluginSettings = sRes?.settings?.plugins?.tbnws || {};
        const validTags = WAREHOUSE_OPTIONS.map((o) => o.value);
        const dfFrom = validTags.includes(pluginSettings.relocationFromTagDefault)
          ? pluginSettings.relocationFromTagDefault : 'GJ';
        const dfTo = validTags.includes(pluginSettings.relocationToTagDefault)
          ? pluginSettings.relocationToTagDefault : 'GT';
        if (!cancelled) {
          setFromTag(dfFrom);
          setToTag(dfTo);
        }

        // title 자동: `{MMDD} {쿠팡|캐논} {round}차`
        const ymd = String(job.date || '').replace(/-/g, '');
        const mmdd = ymd.slice(4, 8);
        const vendorLabel = VENDOR_LABEL[String(job.vendor || '').toLowerCase()]
                         || job.vendor
                         || '';
        if (!cancelled) {
          setTitle(`${mmdd} ${vendorLabel} ${job.sequence || 1}차`);
          setDescription('');
        }

        // po-tbnws.xlsx 로드
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
          productCode: col('상품코드'),
          skuName:     col('SKU 이름'),
          exportQty:   col('반출수량'),
          warehouse:   col('물류센터'),
        };
        // 재고이동 대상 = "반출수량 > 0" 행들을 상품코드별로 합산.
        const groupMap = new Map();
        for (let i = 1; i < aoa.length; i += 1) {
          const r = aoa[i];
          const pc = String(r[idx.productCode] ?? '').trim();
          const qty = Number(r[idx.exportQty]) || 0;
          if (!pc || qty <= 0) continue;
          const prev = groupMap.get(pc);
          if (prev) {
            prev.ea += qty;
          } else {
            groupMap.set(pc, {
              productCode: pc,
              productName: String(r[idx.skuName] ?? '').trim(),
              ea: qty,
            });
          }
        }
        if (!cancelled) setRows(Array.from(groupMap.values()));
      } catch (err) {
        if (!cancelled) setLoadErr(err.message || String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [job]);

  const existingSeq = job?.pluginData?.tbnws?.relocationSeq;

  const totalEa = useMemo(
    () => (rows || []).reduce((s, r) => s + (Number(r.ea) || 0), 0),
    [rows],
  );

  const handleSubmit = async () => {
    if (!rows || rows.length === 0) return;
    const workSeq = job?.pluginData?.tbnws?.workSeq;
    if (workSeq == null) {
      alert('이 작업에 workSeq 가 없습니다.');
      return;
    }
    if (!fromTag || !toTag) {
      alert('From/To 창고 태그를 입력하세요.');
      return;
    }
    if (fromTag === toTag) {
      alert('From 과 To 창고 태그가 같습니다.');
      return;
    }

    // 재등록 경고 + 기존 삭제
    if (existingSeq != null) {
      const ok = window.confirm(
        `이 작업에는 이미 재고이동 #${existingSeq} 가 등록되어 있습니다.\n`
        + '기존 건을 삭제하고 새로 등록할까요? (취소하면 아무 작업도 하지 않습니다)',
      );
      if (!ok) return;
    }

    setSending(true);
    try {
      // 1) 기존 삭제 (있을 때만)
      if (existingSeq != null) {
        const del = await window.electronAPI.invokePluginChannel(
          'tbnws', 'wms.deleteRelocation', { relocationSeq: existingSeq },
        );
        if (!del?.success) {
          // 이미 삭제된 경우 등은 계속 진행
          console.warn('[tbnws] 기존 재고이동 삭제 실패:', del?.error);
        }
        // FK 초기화
        await window.electronAPI.invokePluginChannel(
          'tbnws', 'work.patchRelocationSeq', { workSeq, relocationSeq: null },
        );
      }

      // 2) 등록
      const items = rows.map((r) => ({ productCode: r.productCode, ea: r.ea }));
      const res = await window.electronAPI.invokePluginChannel(
        'tbnws', 'wms.operateRelocation',
        {
          title,
          description,
          fromWarehouseTag: fromTag,
          toWarehouseTag: toTag,
          items,
        },
      );
      if (!res?.success) {
        alert(`재고이동 등록 실패: ${res?.error || 'unknown'}`);
        return;
      }
      const newSeq = res.relocationSeq;

      if (res.testMode) {
        console.info('[tbnws/relocation TEST MODE] url:', res.url, '\nbody:', res.body);
        alert(
          `[테스트 모드] 실제 전송 안 함 — 요청 body 는 DevTools Console 에 로그됨.\n\n`
          + `URL: ${res.url}\n`
          + `${rows.length}상품 · 총 ${totalEa}ea\n\n`
          + `설정에서 '재고이동 테스트 모드' 체크 해제하면 실전송으로 전환됩니다.`,
        );
        onClose();
        return;
      }

      // 3) 쿠팡 작업에 FK 연결
      if (newSeq != null) {
        await window.electronAPI.invokePluginChannel(
          'tbnws', 'work.patchRelocationSeq',
          { workSeq, relocationSeq: newSeq },
        );
      }

      // 4) manifest 에 history 기록
      try {
        const prev = (job.pluginData && job.pluginData.tbnws) || {};
        const prevHistory = Array.isArray(prev.relocationHistory) ? prev.relocationHistory : [];
        const entry = {
          timestamp: new Date().toISOString(),
          relocationSeq: newSeq,
          title,
          description,
          fromWarehouseTag: fromTag,
          toWarehouseTag: toTag,
          items,
          totalEa,
        };
        await window.electronAPI.jobs.updateManifest(
          job.date, job.vendor, job.sequence,
          {
            pluginData: {
              ...(job.pluginData || {}),
              tbnws: {
                ...prev,
                relocationSeq: newSeq,
                relocationHistory: [...prevHistory, entry],
              },
            },
          },
        );
        window.dispatchEvent(new Event('job:reload'));
      } catch (err) {
        console.warn('[tbnws] relocation history 기록 실패', err);
      }

      alert(`재고이동 등록 완료 — relocationSeq=${newSeq} (${items.length}상품, 총 ${totalEa}ea)`);
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
            📦 재고이동 등록
            {rows && <span className="eflex-overlay__count">· {rows.length}상품 · 총 {totalEa}ea</span>}
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
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--color-text-muted)' }}>비고</div>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--color-text-muted)' }}>From 창고</div>
              <select
                value={fromTag}
                onChange={(e) => setFromTag(e.target.value)}
                style={{ width: '100%' }}
              >
                {WAREHOUSE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--color-text-muted)' }}>To 창고</div>
              <select
                value={toTag}
                onChange={(e) => setToTag(e.target.value)}
                style={{ width: '100%' }}
              >
                {WAREHOUSE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>

          {loadErr ? (
            <p className="eflex-overlay__empty">{loadErr}</p>
          ) : rows === null ? (
            <p className="eflex-overlay__empty">불러오는 중…</p>
          ) : rows.length === 0 ? (
            <p className="eflex-overlay__empty">
              반출수량 &gt; 0 인 행이 없습니다.
            </p>
          ) : (
            <table className="eflex-table">
              <thead>
                <tr>
                  <th>상품코드</th>
                  <th>상품명</th>
                  <th className="num">이동수량</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productCode}>
                    <td><code>{r.productCode}</code></td>
                    <td>{r.productName}</td>
                    <td className="num eflex-table__export">{r.ea}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            📦 {sending ? '전송 중…' : `재고이동 등록 (${rows?.length || 0}상품)`}
          </button>
        </footer>
      </div>
    </div>
  );
}
