import React, { useEffect, useMemo, useState } from 'react';
import { I } from '../../icons/v4-icons';

/**
 * v4 PoListView — 특정 날짜의 차수 사이드바 + ALL_POS 테이블.
 *   - 차수 선택 시 비포함 행은 흐림
 *   - "미배정 PO" 그룹: 체크박스로 일부 골라 새 차수 생성
 *
 * Props:
 *   vendor    {id, name, initial?, color?}
 *   date      'YYYY-MM-DD'
 *   onOpenJob (job) => void
 *   onBack    () => void
 *   onCreateJob (posIds) => Promise<void>   // 선택된 미배정 PO id 배열로 새 차수
 */
export default function PoListView({ vendor, date, onOpenJob, onBack, onCreateJob }) {
  const [dayJobs, setDayJobs] = useState([]);
  const [allPos, setAllPos] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('all');
  const [pickedOrphans, setPickedOrphans] = useState(() => new Set());
  const [loading, setLoading] = useState(false);

  // 차수 + ALL_POS 동시 fetch
  useEffect(() => {
    if (!vendor?.id || !date) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      window.electronAPI?.jobs?.list?.(date, vendor.id),
      window.electronAPI?.pos?.listAll?.(vendor.id),
    ])
      .then(([jobsRes, posRes]) => {
        if (cancelled) return;
        const js = Array.isArray(jobsRes?.jobs) ? jobsRes.jobs : Array.isArray(jobsRes) ? jobsRes : [];
        const ps = Array.isArray(posRes?.rows) ? posRes.rows : [];
        setDayJobs(js);
        setAllPos(ps);
        if (js.length > 0) setSelectedJobId(js[0].id || jobKey(js[0]));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vendor?.id, date]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return allPos.filter((p) => !q || `${p.po_number} ${p.name} ${p.barcode || ''} ${p.sku}`.includes(q));
  }, [allPos, search]);

  const orphans = filtered.filter((p) => !p.job_vendor);
  const orphanCount = orphans.length;
  const isOrphanView = selectedJobId === 'orphan';
  const isAllView = selectedJobId === 'all';

  const togglePicked = (id) => setPickedOrphans((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const togglePickedAll = () => setPickedOrphans((s) =>
    s.size === orphans.length ? new Set() : new Set(orphans.map((o) => o.id))
  );

  const handleCreateJob = async () => {
    if (pickedOrphans.size === 0) return;
    if (!onCreateJob) return;
    await onCreateJob([...pickedOrphans]);
    setPickedOrphans(new Set());
  };

  const countForJob = (j) => filtered.filter((p) => p.job_vendor === vendor.id && p.job_date === date && p.job_seq === (j.sequence ?? j.seq)).length;
  const totalForJob = (j) => filtered
    .filter((p) => p.job_vendor === vendor.id && p.job_date === date && p.job_seq === (j.sequence ?? j.seq))
    .reduce((s, p) => s + (p.req_qty || 0), 0);

  return (
    <div className="cal-shell" style={{ flexDirection: 'row' }}>
      <aside className="cal-sidebar">
        <button className="sb-back" onClick={onBack} title="달력으로">
          <I.ChevronL size={13} />
          <span>달력으로</span>
        </button>

        <div className="cal-sb-section">{date.slice(5).replace('-', '/')} · {vendor.name || vendor.id}</div>
        <div className="cal-sb-stat"><span className="lbl">전체 PO</span><span className="val">{filtered.length}건</span></div>
        <div className="cal-sb-stat"><span className="lbl">차수</span><span className="val">{dayJobs.length}개</span></div>
        <div className="cal-sb-stat">
          <span className="lbl">미배정</span>
          <span className="val" style={{ color: orphanCount > 0 ? 'oklch(0.75 0.16 60)' : '#71717A' }}>{orphanCount}건</span>
        </div>

        <div className="cal-sb-section">차수 선택</div>

        <div
          className={'cal-sb-vendor' + (isAllView ? ' active' : '')}
          onClick={() => setSelectedJobId('all')}
        >
          <div className="swatch" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <I.Layers size={12} stroke="#E4E4E7" />
          </div>
          <div className="info">
            <div className="name">전체 PO</div>
            <div className="meta">{filtered.length}건</div>
          </div>
        </div>

        {dayJobs.map((j) => {
          const seq = j.sequence ?? j.seq;
          const id = j.id || jobKey(j);
          const state = j.completed ? 'shipped' : (date === todayStr() ? 'active' : 'draft');
          return (
            <div
              key={id}
              className={'cal-sb-vendor' + (selectedJobId === id ? ' active' : '')}
              onClick={() => setSelectedJobId(id)}
            >
              <div className="swatch" style={{
                background: state === 'shipped' ? 'oklch(0.45 0.10 155)'
                  : state === 'active' ? 'var(--accent)'
                  : 'oklch(0.55 0.12 60)',
                fontSize: 11,
              }}>
                {seq}
              </div>
              <div className="info">
                <div className="name">{seq}차</div>
                <div className="meta">{countForJob(j)}건 · {totalForJob(j)}개</div>
              </div>
              {state === 'shipped' && <I.Check size={11} stroke="#5EBC78" />}
            </div>
          );
        })}

        {orphanCount > 0 && (
          <div
            className={'cal-sb-vendor' + (isOrphanView ? ' active' : '')}
            onClick={() => setSelectedJobId('orphan')}
            style={{ boxShadow: !isOrphanView ? 'inset 0 0 0 1px oklch(0.55 0.16 60 / 0.5)' : undefined }}
          >
            <div className="swatch" style={{ background: 'oklch(0.55 0.16 60)' }}>
              <I.AlertTriangle size={12} stroke="white" />
            </div>
            <div className="info">
              <div className="name">미배정 PO</div>
              <div className="meta">{orphanCount}건</div>
            </div>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ padding: '0 4px 4px' }}>
          {!isAllView && !isOrphanView && (
            <button
              className="v4-btn primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => onOpenJob?.(dayJobs.find((j) => (j.id || jobKey(j)) === selectedJobId))}
            >
              <I.Maximize size={13} /> 작업 창 열기
            </button>
          )}
          {isOrphanView && (
            <button
              className="v4-btn accent"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={pickedOrphans.size === 0}
              onClick={handleCreateJob}
            >
              <I.Plus size={13} /> 새 차수 만들기 ({pickedOrphans.size})
            </button>
          )}
          {isAllView && (
            <div style={{ padding: '8px 10px', fontSize: 10, color: '#71717A', textAlign: 'center' }}>
              차수를 선택하거나<br />미배정 PO 로 새 차수 만들기
            </div>
          )}
        </div>
      </aside>

      <div className="cal-shell">
        <div className="cal-header">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I.Calendar size={16} stroke="var(--text-2)" />
            {date} <span style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 13 }}>· PO 리스트</span>
          </h1>
          {isOrphanView && (
            <div className="v4-badge warn" style={{ fontSize: 11, padding: '4px 10px' }}>
              <I.AlertTriangle size={11} /> 어느 차수에도 없는 PO 만 표시
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div className="v4-search">
            <I.Search size={13} stroke="var(--text-3)" />
            <input
              placeholder="발주·SKU·이름"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading && (
          <div style={{ padding: 20, color: 'var(--text-3)', fontSize: 12 }}>불러오는 중…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="v4-empty">
            <div className="ic"><I.FolderOpen size={20} stroke="var(--text-3)" /></div>
            <div className="ttl">PO 가 없습니다</div>
            <div className="sub">달력에서 PO 갱신을 통해 쿠팡에서 발주서를 가져오세요.</div>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="grid-wrap" style={{ flex: 1 }}>
            <table className="gtable">
              <thead>
                <tr>
                  {isOrphanView && (
                    <th className="check-col">
                      <div
                        className={'v4-cb ' + (pickedOrphans.size > 0 && pickedOrphans.size === orphans.length ? 'on' : pickedOrphans.size > 0 ? 'partial' : '')}
                        onClick={togglePickedAll}
                        title="모두 선택/해제"
                      >
                        {pickedOrphans.size > 0 && pickedOrphans.size === orphans.length
                          ? <I.Check size={11} />
                          : pickedOrphans.size > 0 ? <I.Min size={11} /> : null}
                      </div>
                    </th>
                  )}
                  <th className="row-num">#</th>
                  <th>차수</th>
                  <th>발주번호</th>
                  <th>물류센터</th>
                  <th>바코드</th>
                  <th>상품명</th>
                  <th style={{ textAlign: 'right' }}>발주수량</th>
                  <th>발주일시</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const isOrphan = !p.job_vendor;
                  const memberOfSelected = !isAllView && !isOrphanView
                    && p.job_vendor === vendor.id && p.job_date === date
                    && String(p.job_seq) === String(selectedJobId).split('-').pop()?.replace(/^0+/, '');
                  const isMember = isAllView ? true : isOrphanView ? isOrphan : memberOfSelected;
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
                    <tr key={p.id} style={{ ...style, cursor: onClickRow ? 'pointer' : undefined }} onClick={onClickRow}>
                      {isOrphanView && (
                        <td className="check-col">
                          {isOrphan && (
                            <div className={'v4-cb ' + (isPicked ? 'on' : '')}>
                              {isPicked && <I.Check size={11} />}
                            </div>
                          )}
                        </td>
                      )}
                      <td className="row-num">{i + 1}</td>
                      <td>
                        {p.job_vendor ? (
                          <span className="v4-pill" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
                            {p.job_seq}차
                          </span>
                        ) : (
                          <span className="v4-pill" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                            미배정
                          </span>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>{p.po_number}</td>
                      <td>{p.wh}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{p.barcode || ''}</td>
                      <td>{p.name}</td>
                      <td className="num">{p.req_qty}</td>
                      <td className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{p.order_time}</td>
                      <td>
                        {p.is_new ? <span className="v4-pill" style={{ background: 'oklch(0.95 0.05 60)', color: 'var(--warn)' }}>NEW</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function jobKey(j) {
  return `${j.date}-${j.sequence ?? j.seq}`;
}
