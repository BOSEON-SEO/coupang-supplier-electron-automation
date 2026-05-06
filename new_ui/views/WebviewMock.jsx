// Mock webview content — what user sees in the slide-out panel
function WebviewMock({ stage = 'idle' }) {
  return (
    <div className="wv-mock">
      <div className="wv-toolbar">
        <span style={{display:'inline-flex', gap:4}}>
          <span style={{width:10, height:10, borderRadius:'50%', background:'#FF5F57'}}/>
          <span style={{width:10, height:10, borderRadius:'50%', background:'#FEBC2E'}}/>
          <span style={{width:10, height:10, borderRadius:'50%', background:'#28C840'}}/>
        </span>
        <div className="wv-tab" style={{marginLeft: 8, fontWeight:600}}>공급사 포털 — 발주확정</div>
        <div className="wv-tab" style={{color:'#999'}}>운송지정</div>
        <div style={{flex:1}}/>
        <span className="mono" style={{fontSize:10, color:'#999'}}>partition: canon</span>
      </div>
      <div className="wv-content">
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:12, padding:'8px 12px', background:'oklch(0.95 0.04 250)', borderRadius:4, fontSize:11, color:'oklch(0.42 0.14 250)'}}>
          <I.Loader size={12} stroke="oklch(0.42 0.14 250)"/>
          <span>자동화 동작 중 — Playwright가 발주확정 화면을 조작 중입니다.</span>
        </div>

        <div style={{display:'flex', gap:8, marginBottom:8, alignItems:'center'}}>
          <strong style={{fontSize:13}}>발주 목록</strong>
          <span style={{padding:'1px 6px', background:'#EAEAEA', borderRadius:3, fontSize:10}}>2026-04-30</span>
          <div style={{flex:1}}/>
          <button style={{padding:'4px 10px', background:'#0066CC', color:'white', border:'none', borderRadius:3, fontSize:11, fontWeight:600, boxShadow:'0 0 0 2px rgba(0,102,204,0.3)'}}>발주확정 ⌒</button>
        </div>

        <table className="wv-mock-table">
          <thead>
            <tr>
              <th>발주번호</th><th>센터</th><th>SKU</th><th>요청</th><th>확정</th><th>상태</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['129868291','곤지','4549292221',4,4,'대기'],
              ['129868269','안성4','4549292255',13,0,'반려'],
              ['129799598','안성4','4549292062',192,192,'확정중'],
              ['129799598','안성4','4549292068',4,4,'확정완료'],
              ['129755019','인천26','4549292062',48,48,'대기'],
              ['129751864','안성5','4549292221',4,4,'대기'],
            ].map((r, i) => (
              <tr key={i} className={'wv-mock-row' + (r[5] === '확정중' ? ' highlight' : '')}>
                <td className="mono">{r[0]}</td>
                <td>{r[1]}</td>
                <td className="mono">{r[2]}</td>
                <td style={{textAlign:'right'}} className="mono">{r[3]}</td>
                <td style={{textAlign:'right', fontWeight:600}} className="mono">{r[4]}</td>
                <td>
                  <span style={{
                    padding:'1px 6px', borderRadius:2, fontSize:10,
                    background: r[5] === '확정완료' ? '#E0F4E5' : r[5] === '확정중' ? '#FFF4D9' : r[5] === '반려' ? '#FCE4E4' : '#EFEFEF',
                    color: r[5] === '확정완료' ? '#1F7A3D' : r[5] === '확정중' ? '#8A6213' : r[5] === '반려' ? '#A23030' : '#666'
                  }}>{r[5]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{marginTop:14, padding:10, background:'#FAFAFA', border:'1px dashed #DDD', borderRadius:4, fontSize:10, color:'#666', fontFamily:'JetBrains Mono', lineHeight:1.6}}>
          <div>▸ POST /api/po/confirm — 200 OK (12 rows)</div>
          <div>▸ GET /api/po/status?date=2026-04-30 — pending</div>
          <div style={{color:'#0066CC'}}>▸ 다음: 운송지정 화면 이동</div>
        </div>
      </div>
    </div>
  );
}

window.WebviewMock = WebviewMock;
