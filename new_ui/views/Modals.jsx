// Modals: countdown, WMS upload, Toob coupang export
const { useState: useStateM, useEffect: useEffectM } = React;

function CountdownModal({ onCancel, onComplete, action = '발주확정 업로드' }) {
  const [n, setN] = useStateM(3);
  useEffectM(() => {
    if (n <= 0) { onComplete(); return; }
    const t = setTimeout(() => setN(n - 1), 1000);
    return () => clearTimeout(t);
  }, [n]);

  const r = 44;
  const c = 2 * Math.PI * r;
  const progress = (3 - n) / 3;

  return (
    <div className="modal-bg">
      <div className="modal" style={{minWidth:360, textAlign:'center'}}>
        <div className="modal-head" style={{justifyContent:'center', borderBottom:'none'}}>
          <I.AlertTriangle size={16} stroke="var(--warn)"/>
          <h3>{action} 직전입니다</h3>
        </div>
        <div className="modal-body" style={{paddingTop:0}}>
          <div className="countdown-ring">
            <svg width="96" height="96">
              <circle cx="48" cy="48" r={r} stroke="var(--bg-panel-3)" strokeWidth="6" fill="none"/>
              <circle cx="48" cy="48" r={r} stroke="var(--accent)" strokeWidth="6" fill="none"
                strokeDasharray={c} strokeDashoffset={c * (1 - progress)}
                style={{transition:'stroke-dashoffset 1s linear'}} strokeLinecap="round"/>
            </svg>
            <div className="num">{n > 0 ? n : '✓'}</div>
          </div>
          <div style={{fontSize:13, color:'var(--text)', fontWeight:600, marginBottom:4}}>쿠팡 사이트에 발주확정서가 업로드됩니다</div>
          <div style={{fontSize:11, color:'var(--text-2)'}}>
            대상: <span className="mono">canon · 2026-04-30 · 1차 · 12 SKU</span><br/>
            반려 SKU 2건, 부분 수량 0건 · 총 ₩1,121,733
          </div>
        </div>
        <div className="modal-foot">
          <span style={{flex:1, fontSize:11, color:'var(--text-3)', textAlign:'left'}}>웹뷰 패널에서 진행 상황을 확인할 수 있습니다.</span>
          <button className="btn" onClick={onCancel}>취소</button>
          <button className="btn primary" onClick={onComplete}>지금 진행</button>
        </div>
      </div>
    </div>
  );
}

function WMSUploadModal({ onClose }) {
  const [drag, setDrag] = useStateM(false);
  const [stage, setStage] = useStateM('drop'); // drop | preview
  const previewRows = [
    { wh: '안성4', method: '밀크런', sku: '4549292062', name: '캐논 정품 잉크', q: 96, pal: 'T11×2', inv: '—' },
    { wh: '안성4', method: '밀크런', sku: '4549292068', name: '캐논 PIXMA M4', q: 4, pal: 'T11×1', inv: '—' },
    { wh: '인천26', method: '밀크런', sku: '4549292062', name: '캐논 정품 잉크', q: 48, pal: 'T11×1', inv: '—' },
    { wh: '화성2', method: '쉽먼트', sku: '4549292068', name: '캐논 PIXMA M4', q: 8, pal: '—', inv: '420138291…294' },
    { wh: '화성2', method: '쉽먼트', sku: '4549292255', name: '캐논 가정용 13L', q: 12, pal: '—', inv: '420138291…294' },
    { wh: '덕평2', method: '밀크런', sku: '4549292062', name: '캐논 정품 잉크', q: 96, pal: 'T11×2', inv: '—' },
    { wh: '덕평2', method: '밀크런', sku: '4549292221', name: '캐논 컬러 잉크', q: 24, pal: 'T11×1', inv: '—' },
  ];

  return (
    <div className="modal-bg">
      <div className="modal" style={{minWidth: 720, maxWidth: 920, height: 600}}>
        <div className="modal-head">
          <I.Upload size={16}/>
          <h3>투비 쿠팡반출 — WMS 결과 업로드</h3>
          <div style={{flex:1}}/>
          <button className="icon-btn" onClick={onClose}><I.X size={14}/></button>
        </div>
        <div className="modal-body" style={{padding: 18, flex: 1, overflow:'auto'}}>
          {stage === 'drop' ? (
            <>
              <div className={'dropzone' + (drag ? ' drag' : '')}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); setStage('preview'); }}
                style={{padding: 32}}>
                <I.Upload size={28} stroke={drag ? 'var(--accent)' : 'var(--text-3)'}/>
                <div className="ttl" style={{marginTop: 10}}>WMS 결과 엑셀을 끌어다 놓으세요</div>
                <div className="sub">또는 <button className="btn sm" style={{margin:'0 4px'}} onClick={() => setStage('preview')}><I.File size={11}/> 파일 선택</button>
                  · 16컬럼 형식 · .xlsx</div>
                <div className="sub" style={{marginTop:10, fontFamily:'JetBrains Mono'}}>예: wms-output-canon-20260430.xlsx</div>
              </div>
              <div style={{marginTop:16, padding:12, background:'var(--bg-panel-2)', borderRadius:5, fontSize:11, color:'var(--text-2)'}}>
                <strong style={{display:'block', marginBottom:4, color:'var(--text)'}}>매핑 규칙</strong>
                A: 물류센터 → wh.name &nbsp;·&nbsp; B: 입고유형 &nbsp;·&nbsp; C: SKU &nbsp;·&nbsp; D-G: 수량 분배 &nbsp;·&nbsp; H: 팔레트 프리셋 &nbsp;·&nbsp; I-L: 송장 4구간
              </div>
            </>
          ) : (
            <>
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:12}}>
                <I.FileText size={16} stroke="var(--accent)"/>
                <strong style={{fontSize:13}} className="mono">wms-output-canon-20260430.xlsx</strong>
                <span className="badge mono">7 rows · 4 센터</span>
                <span className="badge ok"><I.CheckCircle size={11}/> 검증 OK</span>
                <div style={{flex:1}}/>
                <button className="btn ghost sm" onClick={() => setStage('drop')}><I.X size={12}/> 다시 선택</button>
              </div>
              <table className="gtable" style={{width:'100%', fontSize:11}}>
                <thead>
                  <tr>
                    <th className="row-num">#</th>
                    <th>센터</th><th>유형</th><th>SKU</th><th>상품명</th>
                    <th style={{textAlign:'right'}}>수량</th><th>팔레트</th><th>송장</th>
                    <th style={{textAlign:'center'}}>검증</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      <td className="row-num">{i+1}</td>
                      <td>{r.wh}</td>
                      <td><span className={'pill ' + (r.method === '쉽먼트' ? 'ship' : 'milk')}>{r.method}</span></td>
                      <td className="mono">{r.sku}</td>
                      <td>{r.name}</td>
                      <td className="num">{r.q}</td>
                      <td className="mono">{r.pal}</td>
                      <td className="mono" style={{fontSize:10, color:'var(--text-2)'}}>{r.inv}</td>
                      <td style={{textAlign:'center'}}><I.Check size={12} stroke="var(--ok)"/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="modal-foot">
          {stage === 'preview' && <span style={{flex:1, fontSize:11, color:'var(--text-2)'}}>적용 시 운송분배 탭의 빈 lot이 자동 채워집니다. 기존 입력은 보존됩니다.</span>}
          <button className="btn" onClick={onClose}>취소</button>
          {stage === 'preview' && <button className="btn primary" onClick={onClose}><I.Check size={13}/> 운송분배에 적용</button>}
        </div>
      </div>
    </div>
  );
}

function ToastStack({ toasts, onClose }) {
  if (!toasts?.length) return null;
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className={'toast ' + t.kind}>
          <div className="icon">
            {t.kind === 'ok' ? <I.CheckCircle size={16} stroke="var(--ok)"/>
              : t.kind === 'warn' ? <I.AlertTriangle size={16} stroke="var(--warn)"/>
              : t.kind === 'err' ? <I.AlertCircle size={16} stroke="var(--danger)"/>
              : <I.Info size={16} stroke="var(--accent)"/>}
          </div>
          <div style={{flex:1}}>
            <div className="ttl">{t.title}</div>
            <div className="msg">{t.msg}</div>
          </div>
          <button className="icon-btn" style={{width:20, height:20}} onClick={() => onClose(t.id)}><I.X size={12}/></button>
        </div>
      ))}
    </div>
  );
}

window.CountdownModal = CountdownModal;
window.WMSUploadModal = WMSUploadModal;
window.ToastStack = ToastStack;
