// Transport distribution view — the most complex screen
const { useState: useStateT, useMemo: useMemoT } = React;

function TransportView({ onOpenWMS }) {
  const { WAREHOUSES } = window.MOCK;
  const [filter, setFilter] = useStateT('all');
  const [expanded, setExpanded] = useStateT({ as4: true, ic26: false, hs2: false, dp2: false });

  const totalBoxes = WAREHOUSES.reduce((s, w) => s + w.boxCount, 0);
  const totalQty = WAREHOUSES.reduce((s, w) => s + w.total, 0);
  const milkQty = WAREHOUSES.filter(w => w.method === '밀크런').reduce((s, w) => s + w.total, 0);
  const shipQty = WAREHOUSES.filter(w => w.method === '쉽먼트').reduce((s, w) => s + w.total, 0);

  const filtered = WAREHOUSES.filter(w => filter === 'all' || (filter === 'ship' && w.method === '쉽먼트') || (filter === 'milk' && w.method === '밀크런'));

  return (
    <>
      <div className="tool-row">
        <div className="filter-chips">
          <button className={'chip' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>전체 <span className="n">{WAREHOUSES.length}</span></button>
          <button className={'chip' + (filter === 'ship' ? ' active' : '')} onClick={() => setFilter('ship')}>쉽먼트 <span className="n">{WAREHOUSES.filter(w=>w.method==='쉽먼트').length}</span></button>
          <button className={'chip' + (filter === 'milk' ? ' active' : '')} onClick={() => setFilter('milk')}>밀크런 <span className="n">{WAREHOUSES.filter(w=>w.method==='밀크런').length}</span></button>
        </div>
        <div style={{flex:1}}/>
        <button className="btn sm" onClick={() => setExpanded(Object.fromEntries(WAREHOUSES.map(w => [w.id, true])))}>모두 펼치기</button>
        <button className="btn sm" onClick={() => setExpanded({})}>모두 접기</button>
        <div style={{width:1, height:18, background:'var(--border)', margin:'0 4px'}}/>
        <button className="btn sm" onClick={onOpenWMS}><I.Upload size={13}/> WMS 결과 업로드</button>
        <button className="btn primary sm"><I.Save size={13}/> 저장</button>
      </div>

      <div className="tr-wrap">
        <div className="tr-summary">
          <div className="stat-card">
            <div className="lbl">총 수량</div>
            <div className="val">{totalQty.toLocaleString()}<span className="unit">개</span></div>
            <div className="delta">
              <span style={{color:'var(--text-3)'}}>4 센터 분배</span>
              <span className="mono" style={{fontWeight:600}}>{WAREHOUSES.length}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="lbl">총 박스</div>
            <div className="val">{totalBoxes}<span className="unit">박스</span></div>
            <div className="delta">
              <div className="bar"><div className="fill" style={{width:'78%'}}/></div>
              <span className="mono" style={{color:'var(--text-3)'}}>78%</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="lbl">밀크런</div>
            <div className="val" style={{color:'oklch(0.42 0.14 80)'}}>{milkQty.toLocaleString()}<span className="unit">개</span></div>
            <div className="delta"><span style={{color:'var(--text-3)'}}>3 센터 · 6 팔레트</span></div>
          </div>
          <div className="stat-card">
            <div className="lbl">쉽먼트</div>
            <div className="val" style={{color:'oklch(0.42 0.14 220)'}}>{shipQty.toLocaleString()}<span className="unit">개</span></div>
            <div className="delta"><span style={{color:'var(--warn)', fontWeight:600}}>1 센터 · 4 박스 · 송장 미입력</span></div>
          </div>
        </div>

        {filtered.map(w => <WHCard key={w.id} wh={w} expanded={!!expanded[w.id]} onToggle={() => setExpanded({...expanded, [w.id]: !expanded[w.id]})}/>)}
      </div>
    </>
  );
}

function WHCard({ wh, expanded, onToggle }) {
  const allocSum = (sku) => Object.values(sku.alloc).reduce((s, v) => s + v, 0);
  return (
    <div className="wh-card">
      <div className="wh-head" onClick={onToggle} style={{cursor:'pointer'}}>
        <I.Building size={16} stroke="var(--text-2)"/>
        <div className="name">{wh.name}</div>
        <span className={'pill ' + (wh.method === '쉽먼트' ? 'ship' : 'milk')}>{wh.method}</span>
        <span className="badge">{wh.lots.length} lot</span>
        <span className="addr">{wh.addr}</span>
        <div className="wh-head-spacer"/>
        <span className="mono" style={{fontSize:12, fontWeight:600}}>{wh.total.toLocaleString()}<span style={{color:'var(--text-3)', fontWeight:400, marginLeft:4}}>개</span></span>
        <span className="mono" style={{fontSize:12, color:'var(--text-2)'}}>· {wh.boxCount} 박스</span>
        <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onToggle(); }}>{expanded ? <I.ChevronU size={14}/> : <I.ChevronD size={14}/>}</button>
      </div>
      {expanded && (
        <div className="wh-body">
          <div className="wh-meta">
            <div className="field-inline">
              <label>출고지</label>
              <select defaultValue={wh.origin}><option>{wh.origin}</option><option>안성공장</option><option>인천창고</option></select>
            </div>
            <div className="field-inline">
              <label>총 박스 수</label>
              <input type="number" defaultValue={wh.boxCount} style={{width:90}}/>
            </div>
            <div className="field-inline">
              <label>입고 예정일</label>
              <input type="date" defaultValue="2026-05-02"/>
            </div>
            <div style={{flex:1}}/>
            <button className="btn sm"><I.Plus size={12}/> 쉽먼트 lot</button>
            <button className="btn sm"><I.Plus size={12}/> 밀크런 lot</button>
          </div>

          {wh.lots.map(lot => lot.type === '밀크런'
            ? <MilkLot key={lot.id} lot={lot} allocSum={allocSum}/>
            : <ShipLot key={lot.id} lot={lot} allocSum={allocSum}/>
          )}
        </div>
      )}
    </div>
  );
}

function MilkLot({ lot, allocSum }) {
  const cols = lot.pallets.length;
  return (
    <div className="lot milk-lot">
      <div className="lot-head">
        <I.Pallet size={14} stroke="oklch(0.42 0.14 80)"/>
        <div className="ttl">밀크런 lot</div>
        <span className="badge">{lot.pallets.length} 팔레트</span>
        <span className="badge accent">{lot.skus.length} SKU</span>
        <div style={{flex:1}}/>
        <button className="btn ghost sm"><I.Edit size={12}/></button>
        <button className="btn ghost sm"><I.Trash size={12} stroke="var(--danger)"/></button>
      </div>
      <div className="lot-body">
        <div className="pallet-list">
          {lot.pallets.map((p, i) => {
            const filled = lot.skus.reduce((s, sk) => s + (sk.alloc[p.id] || 0), 0);
            const isEmpty = filled === 0;
            return (
              <div key={p.id} className={'pallet' + (isEmpty ? ' empty' : '')}>
                <div className="label"><I.Pallet size={11}/> {p.label}</div>
                <div className="preset">{p.preset} · {p.boxCount}박스</div>
                <div className="stack">{Array.from({length: 6}).map((_, j) => <span key={j} style={{height: `${30 + (i+j)*8 % 70}%`, opacity: isEmpty ? 0.15 : (0.4 + (j*0.1)) }}/>)}</div>
                <div className="total">{filled}<span style={{color:'var(--text-3)', fontWeight:400, marginLeft:4}}>/ {p.boxCount * 4}</span></div>
              </div>
            );
          })}
          <div className="pallet empty" style={{cursor:'pointer'}}>
            <div className="label" style={{color:'var(--text-3)'}}><I.Plus size={11}/> 팔레트 추가</div>
            <div className="preset">프리셋 선택</div>
            <div className="stack" style={{opacity:0.3}}>{Array.from({length: 6}).map((_, j) => <span key={j} style={{height:'30%'}}/>)}</div>
          </div>
        </div>

        <div className="sku-head" style={{'--cols': cols}}>
          <div>SKU</div>
          {lot.pallets.map(p => <div key={p.id}>{p.label}</div>)}
          <div>합계</div>
        </div>
        {lot.skus.map(sk => {
          const total = allocSum(sk);
          const splitCount = Object.values(sk.alloc).filter(v => v > 0).length;
          return (
            <div key={sk.rowKey} className={'sku-row ' + (total > 0 ? 'ok' : 'warn')} style={{'--cols': cols}}>
              <div className="sku-name">
                <span className="barcode">{sk.barcode}</span>{sk.name}
                {splitCount > 1 && <span className="pill partial" style={{marginLeft:8}}>분할 {splitCount}</span>}
              </div>
              {lot.pallets.map(p => (
                <div key={p.id} className={'qty-cell' + (sk.alloc[p.id] > 0 && splitCount > 1 ? ' split' : '')}>
                  <input type="number" defaultValue={sk.alloc[p.id] || ''} placeholder="0"/>
                </div>
              ))}
              <div className="total-cell">{total}</div>
            </div>
          );
        })}
        <div style={{padding:'8px 0 0', display:'flex', gap:6}}>
          <button className="btn ghost sm"><I.Plus size={12}/> SKU 추가</button>
          <div style={{flex:1}}/>
          <span style={{fontSize:11, color:'var(--text-3)', alignSelf:'center'}}>
            <kbd className="mono" style={{padding:'1px 5px', border:'1px solid var(--border)', borderRadius:3, fontSize:10}}>Tab</kbd> 다음 셀 ·
            <kbd className="mono" style={{padding:'1px 5px', border:'1px solid var(--border)', borderRadius:3, fontSize:10, marginLeft:4}}>Enter</kbd> 확정
          </span>
        </div>
      </div>
    </div>
  );
}

function ShipLot({ lot, allocSum }) {
  const cols = lot.boxes.length;
  return (
    <div className="lot ship-lot">
      <div className="lot-head">
        <I.Box size={14} stroke="oklch(0.42 0.14 220)"/>
        <div className="ttl">쉽먼트 lot</div>
        <span className="badge">{lot.boxes.length} 박스</span>
        <span className="badge accent">{lot.skus.length} SKU</span>
        <span className="badge warn">송장 4건</span>
        <div style={{flex:1}}/>
        <button className="btn ghost sm"><I.Edit size={12}/></button>
        <button className="btn ghost sm"><I.Trash size={12} stroke="var(--danger)"/></button>
      </div>
      <div className="lot-body">
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:8, marginBottom:10}}>
          {lot.boxes.map(b => (
            <div key={b.id} style={{border:'1px solid var(--border)', borderRadius:4, padding:'8px 10px', background:'var(--bg-panel-2)'}}>
              <div style={{fontSize:11, fontWeight:600, marginBottom:4, display:'flex', alignItems:'center', gap:4}}><I.Box size={11}/> {b.label}</div>
              <input className="mono" defaultValue={b.invoice} style={{width:'100%', height:24, padding:'0 6px', border:'1px solid var(--border)', borderRadius:3, fontSize:11, background:'white'}}/>
            </div>
          ))}
        </div>
        <div className="sku-head" style={{'--cols': cols}}>
          <div>SKU</div>
          {lot.boxes.map(b => <div key={b.id}>{b.label}</div>)}
          <div>합계</div>
        </div>
        {lot.skus.map(sk => (
          <div key={sk.rowKey} className="sku-row ok" style={{'--cols': cols}}>
            <div className="sku-name"><span className="barcode">{sk.barcode}</span>{sk.name}</div>
            {lot.boxes.map(b => (
              <div key={b.id} className="qty-cell"><input type="number" defaultValue={sk.alloc[b.id] || ''}/></div>
            ))}
            <div className="total-cell">{allocSum(sk)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.TransportView = TransportView;
