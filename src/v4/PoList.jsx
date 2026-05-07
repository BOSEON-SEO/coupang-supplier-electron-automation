// v4 PO List view — opened from Calendar. Sidebar lists 차수, main shows ALL POs.
// Selecting a 차수 dims non-member POs. Orphans (no 차수) are color-flagged.
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { I } from './icons';

// 실 manifest → mockup 차수 모양 변환
function adaptManifest(m, today) {
  const seq = m.sequence ?? m.seq;
  const state = m.completed ? 'shipped' : (m.date === today ? 'active' : 'draft');
  return {
    id: `${m.vendor}-${m.date}-${seq}`,
    vendor: m.vendor,
    date: m.date,
    seq,
    state,
    label: `${m.date.slice(5).replace('-','/')} ${seq}차`,
    skus: m.stats?.skuCount || 0,
    qty: m.stats?.totalQty || 0,
    raw: m,
  };
}

// DB pos row → mockup PO 모양 변환
//   DB: { id, vendor_id, po_number, wh, sku, barcode, name, req_qty, order_time, job_vendor, job_date, job_seq, is_new }
//   mockup: { id, jobId, po, wh, sku, barcode, name, reqQty, orderTime, isNew }
function adaptPos(row) {
  return {
    id: row.id,
    jobId: row.job_vendor && row.job_date && row.job_seq != null
      ? `${row.job_vendor}-${row.job_date}-${row.job_seq}`
      : null,
    po: row.po_number,
    wh: row.wh,
    sku: row.sku,
    barcode: row.barcode || row.sku,
    name: row.name,
    reqQty: row.req_qty,
    orderTime: row.order_time,
    isNew: !!row.is_new,
  };
}

export default function PoListView({ vendor, date, onOpenJob, onBack, onCreateJob }) {
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

  // 차수 + 전체 PO 풀 (해당 벤더) 동시 fetch
  const [dayJobs, setDayJobs] = useState([]);
  const [allPos, setAllPos] = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!vendor?.id) return;
    setLoading(true);
    try {
      const [jobsRes, posRes] = await Promise.all([
        window.electronAPI?.jobs?.list?.(date, vendor.id),
        window.electronAPI?.pos?.listAll?.(vendor.id),
      ]);
      const manifests = Array.isArray(jobsRes?.jobs) ? jobsRes.jobs : [];
      setDayJobs(manifests.map((m) => adaptManifest(m, today)));
      const rows = Array.isArray(posRes?.rows) ? posRes.rows : [];
      setAllPos(rows.map(adaptPos));
    } finally {
      setLoading(false);
    }
  }, [vendor?.id, date, today]);

  useEffect(() => { reload(); }, [reload]);

  const [selectedJobId, setSelectedJobId] = useState('all');
  useEffect(() => { if (dayJobs.length > 0 && selectedJobId === 'all') setSelectedJobId(dayJobs[0].id); }, [dayJobs]);

  const [search, setSearch] = useState('');
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pickedOrphans, setPickedOrphans] = useState(new Set());
  const togglePicked = (id) => setPickedOrphans(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePickedAll = (orphans) => setPickedOrphans(s =>
    orphans.length === s.size ? new Set() : new Set(orphans.map(o => o.id))
  );

  const scopedPos = useMemo(() =>
    allPos.filter(p => p.po && (search === '' || `${p.po} ${p.name} ${p.barcode}`.includes(search))),
    [allPos, search]
  );

  const orphanCount = scopedPos.filter(p => p.jobId === null).length;
  const isOrphanView = selectedJobId === 'orphan';
  const isAllView = selectedJobId === 'all';

  const totalForJob = (jobId) => scopedPos.filter(p => p.jobId === jobId).reduce((s, p) => s + p.reqQty, 0);
  const countForJob = (jobId) => scopedPos.filter(p => p.jobId === jobId).length;

  // 차수 생성 — 선택된 orphan PO 들로 새 sequence 생성 후 assignToJob
  const handleCreateJob = async () => {
    if (pickedOrphans.size === 0 || !vendor?.id) return;
    if (creating) return;
    setCreating(true);
    try {
      const ids = [...pickedOrphans];
      const createRes = await window.electronAPI?.jobs?.create?.(date, vendor.id, {});
      if (!createRes?.success) {
        alert('차수 생성 실패: ' + (createRes?.error || 'unknown'));
        return;
      }
      const seq = createRes.sequence ?? createRes.manifest?.sequence;
      if (seq == null) { alert('차수 생성 응답에 sequence 없음'); return; }
      const assignRes = await window.electronAPI?.pos?.assignToJob?.(ids, vendor.id, date, seq);
      if (!assignRes?.success) {
        alert('PO 배정 실패: ' + (assignRes?.error || 'unknown'));
        return;
      }
      setPickedOrphans(new Set());
      await reload();
      // 선택사항: 생성 즉시 차수 선택
      setSelectedJobId(`${vendor.id}-${date}-${seq}`);
      if (onCreateJob) onCreateJob(ids, { date, sequence: seq });
    } catch (err) {
      alert('차수 생성 중 오류: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="cal-shell" style={{flexDirection:'row'}}>
      {/* Sidebar — 차수 list */}
      <div className="cal-sidebar">
        <button className="sb-back" onClick={onBack} title="달력으로">
          <I.ChevronL size={13}/>
          <span>달력으로</span>
        </button>

        <div className="cal-sb-section">{date.slice(5).replace('-','/')} · {vendor.name}</div>
        <div className="cal-sb-stat"><span className="lbl">전체 PO</span><span className="val">{scopedPos.length}건</span></div>
        <div className="cal-sb-stat"><span className="lbl">차수</span><span className="val">{dayJobs.length}개</span></div>
        <div className="cal-sb-stat"><span className="lbl">미배정</span><span className="val" style={{color: orphanCount > 0 ? 'oklch(0.75 0.16 60)' : '#71717A'}}>{orphanCount}건</span></div>

        <div className="cal-sb-section">차수 선택</div>

        <div className={'cal-sb-vendor' + (isAllView ? ' active' : '')} onClick={() => setSelectedJobId('all')} style={{padding: '8px 10px'}}>
          <div style={{width:24, height:24, borderRadius:5, background:'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center'}}>
            <I.Layers size={12} stroke="#E4E4E7"/>
          </div>
          <div className="info">
            <div className="name" style={{fontSize:12}}>전체 PO</div>
            <div className="meta">{scopedPos.length}건</div>
          </div>
        </div>

        {dayJobs.map(j => (
          <div key={j.id} className={'cal-sb-vendor' + (selectedJobId === j.id ? ' active' : '')} onClick={() => setSelectedJobId(j.id)} style={{padding:'8px 10px'}}>
            <div style={{width:24, height:24, borderRadius:5, background: j.state === 'shipped' ? 'oklch(0.45 0.10 155)' : j.state === 'active' ? 'var(--accent)' : 'oklch(0.55 0.12 60)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:11}}>
              {j.seq}
            </div>
            <div className="info">
              <div className="name" style={{fontSize:12}}>{j.label}</div>
              <div className="meta">{countForJob(j.id)}건 · {totalForJob(j.id)}개</div>
            </div>
            {j.state === 'shipped' && <I.Check size={11} stroke="#5EBC78"/>}
            {j.state === 'active' && <span style={{width:6, height:6, borderRadius:'50%', background:'var(--accent)', animation:'pulse 2s infinite'}}/>}
          </div>
        ))}

        {orphanCount > 0 && (
          <div className={'cal-sb-vendor' + (isOrphanView ? ' active' : '')} onClick={() => setSelectedJobId('orphan')} style={{padding: '8px 10px', boxShadow: !isOrphanView ? 'inset 0 0 0 1px oklch(0.55 0.16 60 / 0.5)' : undefined}}>
            <div style={{width:24, height:24, borderRadius:5, background:'oklch(0.55 0.16 60)', display:'flex', alignItems:'center', justifyContent:'center'}}>
              <I.AlertTriangle size={12} stroke="white"/>
            </div>
            <div className="info">
              <div className="name" style={{fontSize:12}}>미배정 PO</div>
              <div className="meta">{orphanCount}건</div>
            </div>
          </div>
        )}

        <div style={{flex:1}}/>

        {/* Action depends on selection */}
        <div style={{padding: '0 8px 8px'}}>
          {!isAllView && !isOrphanView && (
            <button className="btn primary" style={{width:'100%', justifyContent:'center'}} onClick={() => onOpenJob(dayJobs.find(j => j.id === selectedJobId))}>
              <I.Maximize size={13}/> 작업 창 열기
            </button>
          )}
          {isOrphanView && (
            <button
              className="btn accent"
              style={{width:'100%', justifyContent:'center'}}
              disabled={pickedOrphans.size === 0 || creating}
              onClick={handleCreateJob}
              title={pickedOrphans.size === 0 ? '체크한 PO 없음' : `선택한 ${pickedOrphans.size}건으로 새 차수 만들기`}
            >
              <I.Plus size={13}/> {creating ? '생성 중…' : `새 차수 만들기 (${pickedOrphans.size})`}
            </button>
          )}
          {isAllView && (
            <div style={{padding:'8px 10px', fontSize:10, color:'#71717A', textAlign:'center'}}>
              차수를 선택하거나<br/>미배정 PO로 새 차수 만들기
            </div>
          )}
        </div>
      </div>

      {/* Main — PO table */}
      <div className="cal-shell">
        <div className="cal-header">
          <h1 style={{display:'flex', alignItems:'center', gap:8}}>
            <I.Calendar size={16} stroke="var(--text-2)"/>
            {date} <span style={{color:'var(--text-3)', fontWeight:400, fontSize:13}}>· PO 리스트</span>
          </h1>
          {isOrphanView && (
            <div className="badge warn" style={{fontSize:11, padding:'4px 10px'}}>
              <I.AlertTriangle size={11}/> 어느 차수에도 없는 PO만 표시
            </div>
          )}
          <div style={{flex:1}}/>
          <div className="search">
            <I.Search size={13} stroke="var(--text-3)"/>
            <input placeholder="발주·SKU·이름" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <button className="btn" onClick={() => setRefreshOpen(true)}><I.RefreshCw size={13}/> PO 갱신</button>
        </div>

        {/* Legend */}
        <div style={{padding: '10px 22px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--border)', display:'flex', alignItems:'center', gap:14, fontSize:11, color:'var(--text-3)'}}>
          <span>범례:</span>
          <span style={{display:'inline-flex', alignItems:'center', gap:5}}><span style={{width:10, height:10, background:'var(--bg-elev)', borderLeft:'3px solid var(--accent)'}}/>선택한 차수</span>
          <span style={{display:'inline-flex', alignItems:'center', gap:5}}><span style={{width:10, height:10, background:'oklch(0.97 0.005 250)', borderLeft:'3px solid var(--text-3)'}}/>다른 차수 (흐림)</span>
          <span style={{display:'inline-flex', alignItems:'center', gap:5}}><span style={{width:10, height:10, background:'var(--warn-soft)', borderLeft:'3px solid var(--warn)'}}/>미배정 (신규)</span>
          <div style={{flex:1}}/>
          <span className="mono" style={{color:'var(--text-3)'}}>전체 {scopedPos.length}건 · 신규 {orphanCount}건 빨려옴</span>
        </div>

        <div className="grid-wrap" style={{flex:1}}>
          <table className="gtable">
            <thead>
              <tr>
                {isOrphanView && (
                  <th className="check-col">
                    <div
                      className={'cb ' + (pickedOrphans.size > 0 && pickedOrphans.size === scopedPos.filter(p => p.jobId === null).length ? 'on' : pickedOrphans.size > 0 ? 'partial' : '')}
                      onClick={() => togglePickedAll(scopedPos.filter(p => p.jobId === null))}
                      title="모두 선택/해제"
                    >
                      {pickedOrphans.size > 0 && pickedOrphans.size === scopedPos.filter(p => p.jobId === null).length
                        ? <I.Check size={11}/>
                        : pickedOrphans.size > 0 ? <I.Min size={11}/> : null}
                    </div>
                  </th>
                )}
                <th className="row-num">#</th>
                <th>차수</th>
                <th>발주번호</th>
                <th>물류센터</th>
                <th>바코드</th>
                <th>상품명</th>
                <th style={{textAlign:'right'}}>발주수량</th>
                <th>발주일시</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {scopedPos.map((p, i) => {
                const isMember = isAllView ? true : isOrphanView ? p.jobId === null : p.jobId === selectedJobId;
                const isOrphan = p.jobId === null;
                const job = V4PL_JOBS.find(j => j.id === p.jobId);
                const isPicked = pickedOrphans.has(p.id);

                let style = {};
                if (!isMember) {
                  style.opacity = 0.32;
                  style.background = 'oklch(0.98 0.005 250)';
                }
                if (isOrphan && (isAllView || isOrphanView)) {
                  style.background = 'var(--warn-soft)';
                  style.borderLeft = '3px solid var(--warn)';
                }
                if (isMember && !isAllView && !isOrphanView) {
                  style.borderLeft = '3px solid var(--accent)';
                }
                if (isOrphanView && isPicked) {
                  style.background = 'var(--accent-soft)';
                  style.borderLeft = '3px solid var(--accent)';
                }

                const onClickRow = isOrphanView && isOrphan ? () => togglePicked(p.id) : undefined;

                return (
                  <tr key={p.id} style={{...style, cursor: onClickRow ? 'pointer' : undefined}} onClick={onClickRow}>
                    {isOrphanView && (
                      <td className="check-col">
                        {isOrphan && (
                          <div className={'cb ' + (isPicked ? 'on' : '')}>
                            {isPicked && <I.Check size={11}/>}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="row-num">{i + 1}</td>
                    <td>
                      {p.jobId ? (
                        <span className="pill" style={{background: job?.state === 'shipped' ? 'var(--ok-soft)' : 'var(--accent-soft)', color: job?.state === 'shipped' ? 'var(--ok)' : 'var(--accent-strong)'}}>
                          {job?.label || p.jobId}
                        </span>
                      ) : (
                        <span className="pill" style={{background: 'var(--warn-soft)', color: 'var(--warn)'}}>미배정</span>
                      )}
                    </td>
                    <td className="mono" style={{fontSize:11}}>{p.po}</td>
                    <td>{p.wh}</td>
                    <td className="mono" style={{fontSize:11}}>{p.barcode}</td>
                    <td>{p.name}</td>
                    <td className="num">{p.reqQty}</td>
                    <td className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{p.orderTime}</td>
                    <td>
                      {p.isNew && <span className="pill" style={{background:'oklch(0.95 0.05 60)', color:'var(--warn)'}}>NEW</span>}
                      {!p.isNew && job?.state === 'shipped' && <span className="pill send">완료</span>}
                      {!p.isNew && job?.state === 'active' && <span className="pill" style={{background:'var(--accent-soft)', color:'var(--accent-strong)'}}>진행 중</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {refreshOpen && (
        <PoUpdateModalV4
          vendor={vendor}
          date={date}
          onClose={() => setRefreshOpen(false)}
          onRefreshed={(result) => { setRefreshOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

import { parsePoBuffer } from '../core/poParser';

function PoUpdateModalV4({ vendor, date, onClose, onRefreshed }) {
  const [source, setSource] = useState('coupang');
  // 기본값: 달력에서 선택된 날짜 (없으면 오늘 -2일)
  const defaultFrom = (() => {
    if (date) return `${date}T09:00`;
    const d = new Date(); d.setDate(d.getDate() - 2);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T09:00`;
  })();
  const [from, setFrom] = useState(defaultFrom);
  const [excelFile, setExcelFile] = useState(null); // File object
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(''); // 'downloading' | 'parsing' | 'saving' | 'done'
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { added, skipped, addedPoNumbers }
  const cancelledRef = React.useRef(false);
  const fileInputRef = React.useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const canSubmit = !busy && (source === 'coupang' || (source === 'excel' && excelFile));

  const fetchAndApply = async (filePath) => {
    setStage('parsing');
    const read = await window.electronAPI?.readFile?.(filePath);
    if (!read?.success) throw new Error('파일 읽기 실패: ' + (read?.error || filePath));
    // ArrayBuffer 또는 Buffer{type, data}
    const buf = read.data instanceof ArrayBuffer ? read.data
      : (read.data?.data ? new Uint8Array(read.data.data).buffer : read.data);
    const rows = parsePoBuffer(buf);
    if (!rows.length) throw new Error('xlsx 에서 PO 행을 찾을 수 없습니다');

    setStage('saving');
    // poParser 결과 → pos schema 매핑
    const mapped = rows.map((r) => ({
      po_number: String(r.coupang_order_seq || ''),
      wh: r.departure_warehouse || '',
      sku: String(r.sku_id || ''),
      barcode: r.sku_barcode || null,
      name: r.sku_name || '',
      req_qty: Number(r.order_quantity) || 0,
      order_time: r.order_date || '',
    })).filter((r) => r.po_number && r.sku);

    const res = await window.electronAPI?.pos?.addNewOnly?.(vendor.id, mapped);
    if (!res?.success) throw new Error('DB 저장 실패: ' + (res?.error || 'unknown'));
    setStage('done');
    setResult(res);
    return res;
  };

  // 사용자가 진행 중에 webview 창을 닫으면 자동 취소
  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api?.onVisibilityChanged) return;
    const off = api.onVisibilityChanged(({ visible }) => {
      if (busy && stage === 'downloading' && !visible) {
        handleCancel('웹뷰 창이 닫혀 작업이 취소되었습니다');
      }
    });
    return () => { if (typeof off === 'function') off(); };
  }, [busy, stage]);

  const handleCancel = async (msg) => {
    if (!busy) return;
    cancelledRef.current = true;
    try { await window.electronAPI?.cancelPython?.(); } catch (_) { /* ignore */ }
    setBusy(false); setStage(''); setError(msg || '취소됨');
  };

  const handleCoupang = async () => {
    cancelledRef.current = false;
    setBusy(true); setError(''); setStage('downloading'); setResult(null);
    try {
      const api = window.electronAPI;
      // 1) webview 창 자동 노출 (자동화 진행을 보면서 디버그)
      await api?.webview?.setVendor?.(vendor.id);
      await api?.webview?.setVisible?.(true);
      // 2) 약간 대기 — 새 창이 처음 생성되는 경우 page load 시간 확보
      await new Promise((r) => setTimeout(r, 400));

      const dateFrom = from.slice(0, 10);
      // --date-to 미지정 시 script default = 오늘. dateFrom > 오늘이면 from>to 되어
      // 결과 0건. "이 날짜 이후 전부" 의미를 살리려면 충분히 먼 미래로 설정.
      const dateTo = '2099-12-31';
      const args = ['--vendor', vendor.id, '--date-from', dateFrom, '--date-to', dateTo];
      const runRes = await api?.runPython?.('scripts/po_download.py', args);
      if (!runRes?.success) throw new Error('python 실행 실패: ' + (runRes?.error || 'unknown'));
      // python:done 이벤트 대기
      const filePath = await waitPythonDone('po_download.py');
      if (!filePath) throw new Error('다운로드 결과 파일을 찾을 수 없습니다');
      await fetchAndApply(filePath);
    } catch (err) {
      setError(err.message); setStage('');
    } finally {
      setBusy(false);
    }
  };

  const handleExcel = async () => {
    if (!excelFile) return;
    setError(''); setBusy(true); setStage('parsing'); setResult(null);
    try {
      const buf = await excelFile.arrayBuffer();
      const rows = parsePoBuffer(buf);
      if (!rows.length) throw new Error('xlsx 에서 PO 행을 찾을 수 없습니다');
      setStage('saving');
      const mapped = rows.map((r) => ({
        po_number: String(r.coupang_order_seq || ''),
        wh: r.departure_warehouse || '',
        sku: String(r.sku_id || ''),
        barcode: r.sku_barcode || null,
        name: r.sku_name || '',
        req_qty: Number(r.order_quantity) || 0,
        order_time: r.order_date || '',
      })).filter((r) => r.po_number && r.sku);
      const res = await window.electronAPI?.pos?.addNewOnly?.(vendor.id, mapped);
      if (!res?.success) throw new Error(res?.error || 'DB 저장 실패');
      setStage('done'); setResult(res);
    } catch (err) {
      setError(err.message); setStage('');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = () => {
    if (busy) return;
    if (source === 'coupang') handleCoupang();
    else handleExcel();
  };

  const stageLabel = {
    downloading: '쿠팡에서 다운로드 중…',
    parsing: 'xlsx 파싱 중…',
    saving: 'DB 저장 중…',
    done: '완료',
  }[stage] || '';

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 480 }}>
        <div className="modal-head">
          <h3><I.RefreshCw size={14}/>PO 갱신</h3>
          <div className="sub">쿠팡에서 새 발주를 가져옵니다. <strong>발주번호 기준 dedup</strong> — 이미 있는 PO는 건너뜁니다.</div>
        </div>
        <div className="modal-body">
          {/* 좌/우 탭 */}
          <div className="po-source-tabs">
            <button
              type="button"
              className={'po-source-tab' + (source === 'coupang' ? ' active' : '')}
              onClick={() => !busy && setSource('coupang')}
              disabled={busy}
            >
              <I.Globe size={18}/>
              <div className="ttl">쿠팡 사이트</div>
              <div className="sub">자동화 다운로드</div>
            </button>
            <button
              type="button"
              className={'po-source-tab' + (source === 'excel' ? ' active' : '')}
              onClick={() => !busy && setSource('excel')}
              disabled={busy}
            >
              <I.FolderOpen size={18}/>
              <div className="ttl">Excel 업로드</div>
              <div className="sub">.xlsx 파일</div>
            </button>
          </div>

          {/* 탭별 본문 */}
          {source === 'coupang' && (
            <div className="po-source-body">
              <div className="field" style={{ marginBottom: 8 }}>
                <label>발주일시 ≥</label>
                <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} disabled={busy}/>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                쿠팡 서플라이어 허브에 자동 로그인 → PO SKU 목록 페이지에서 위 일시 이후 발주를 다운로드합니다.
              </div>
            </div>
          )}
          {source === 'excel' && (
            <div className="po-source-body">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(ev) => setExcelFile(ev.target.files?.[0] || null)}
                disabled={busy}
              />
              <div
                className={'po-file-drop' + (excelFile ? ' picked' : '') + (dragActive ? ' drag-over' : '')}
                onClick={() => !busy && fileInputRef.current?.click()}
                onDragEnter={(e) => { if (busy) return; e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                onDragOver={(e) => { if (busy) return; e.preventDefault(); e.stopPropagation(); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                onDrop={(e) => {
                  if (busy) return;
                  e.preventDefault(); e.stopPropagation(); setDragActive(false);
                  const f = e.dataTransfer?.files?.[0];
                  if (!f) return;
                  if (!/\.(xlsx|xls)$/i.test(f.name)) { setError('xlsx/xls 파일만 업로드 가능합니다'); return; }
                  setExcelFile(f);
                }}
              >
                {excelFile ? (
                  <>
                    <I.CheckCircle size={20} stroke="var(--ok)"/>
                    <div className="ttl">{excelFile.name}</div>
                    <div className="sub mono">{(excelFile.size/1024).toFixed(1)} KB · 다른 파일로 변경하려면 클릭/드롭</div>
                  </>
                ) : (
                  <>
                    <I.FolderOpen size={20} stroke="var(--text-3)"/>
                    <div className="ttl">{dragActive ? '여기에 놓기' : '파일 선택 또는 드래그'}</div>
                    <div className="sub">PO SKU 다운로드 .xlsx</div>
                  </>
                )}
              </div>
            </div>
          )}

          {stage && stage !== 'done' && (
            <div style={{padding:10, background:'var(--accent-soft)', borderRadius:5, fontSize:12, color:'var(--accent-strong)', display:'flex', gap:8, alignItems:'center'}}>
              <I.Loader size={13}/>
              <span>{stageLabel}</span>
            </div>
          )}
          {stage === 'done' && result && (
            <div style={{padding:10, background:'var(--ok-soft)', borderRadius:5, fontSize:12, color:'var(--ok)', display:'flex', flexDirection:'column', gap:4}}>
              <div style={{display:'flex', gap:8, alignItems:'center', fontWeight:600}}>
                <I.CheckCircle size={13}/>
                갱신 완료
              </div>
              <div>신규 추가 <strong className="mono">{result.added}</strong>건 · 중복 제외 <strong className="mono">{result.skipped}</strong>건</div>
            </div>
          )}
          {error && (
            <div style={{padding:10, background:'var(--danger-soft)', borderRadius:5, fontSize:12, color:'var(--danger)', display:'flex', gap:8}}>
              <I.AlertTriangle size={13}/>
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          {stage === 'done' ? (
            <button className="btn primary" onClick={() => onRefreshed?.(result)}>확인</button>
          ) : busy ? (
            <button className="btn danger" onClick={() => handleCancel()}>
              <I.X size={13}/> 중단
            </button>
          ) : (
            <>
              <button className="btn ghost" onClick={onClose}>취소</button>
              <button
                className="btn primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
                title={source === 'excel' && !excelFile ? '파일을 먼저 선택하세요' : ''}
              >
                <I.RefreshCw size={13}/> 받기
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// python:done 이벤트 대기 + 결과 파일 경로 추출.
// po_download.py 가 다운로드한 파일을 찾기 위해 file:listVendorFiles 로 latest 검색.
function waitPythonDone(scriptSuffix) {
  return new Promise((resolve, reject) => {
    const api = window.electronAPI;
    if (!api?.onPythonDone) { reject(new Error('python IPC 미지원')); return; }
    const timer = setTimeout(() => { unsub?.(); reject(new Error('타임아웃 (10분 초과)')); }, 10 * 60 * 1000);
    const unsub = api.onPythonDone(async (data) => {
      const name = data?.scriptName || '';
      if (!name.includes(scriptSuffix)) return;
      clearTimeout(timer);
      try { unsub(); } catch (_) { /* ignore */ }
      if (data.killed) { reject(new Error('사용자 취소')); return; }
      if (data.exitCode !== 0) { reject(new Error('python 실패 (exitCode=' + data.exitCode + ')')); return; }
      // 갱신된 결과 파일 검색 — 가장 최근의 {vendor}-{date}-{seq}.xlsx
      try {
        const v = data.vendorId || data.scriptName || '';
        const list = await api.listVendorFiles?.();
        const files = (list?.files || []).filter((f) => /\.xlsx$/i.test(f));
        files.sort((a, b) => b.localeCompare(a)); // 이름 desc — 날짜+seq 가 들어있어 최신이 위
        if (!files.length) { resolve(null); return; }
        const top = files[0];
        const resolved = await api.resolveVendorPath?.(top);
        resolve(resolved?.path || null);
      } catch (err) {
        reject(err);
      }
    });
  });
}

