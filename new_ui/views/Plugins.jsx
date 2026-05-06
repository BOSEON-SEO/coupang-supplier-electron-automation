// Plugins view
function PluginsView() {
  const plugins = [
    { id: 'tbnws', name: '투비 (캐논 전용)', vendor: '캐논', enabled: true, ver: '0.4.2', desc: 'WMS 결과 엑셀 매핑, 이플렉스 출고 연동, 쿠팡반출 양식 자동 생성', features: ['이플렉스 출고','재고 이동 등록','출고 예정 등록','쿠팡반출 양식'] },
    { id: 'remote-cal', name: '원격 캘린더 동기화', vendor: '전체', enabled: true, ver: '1.1.0', desc: '외부 ERP 일정 fetch — 차수 자동 생성', features: ['ERP fetch (5분 주기)','차수 자동 생성','충돌 알림'] },
    { id: 'invoice-print', name: '송장 일괄 인쇄', vendor: '전체', enabled: false, ver: '0.2.1', desc: '쉽먼트 lot 송장 PDF 일괄 출력', features: ['PDF 미리보기','용지 프리셋','배치 인쇄'] },
    { id: 'metric-export', name: '지표 내보내기 (BI)', vendor: '전체', enabled: false, ver: 'beta', desc: '월별 차수 지표를 외부 BI 도구로 전송', features: ['CSV/Parquet','Tableau','Looker'] },
  ];
  return (
    <div style={{flex:1, overflow:'auto', background:'var(--bg-panel-2)', padding:24}}>
      <div style={{maxWidth: 880}}>
        <div style={{display:'flex', alignItems:'baseline', gap:12, marginBottom:4}}>
          <h2 style={{margin:0, fontSize:20, fontWeight:600, letterSpacing:-0.3}}>플러그인</h2>
          <span className="badge accent">{plugins.filter(p=>p.enabled).length} 활성</span>
        </div>
        <p style={{margin:'0 0 24px', color:'var(--text-3)', fontSize:12}}>벤더별 특화 기능. 활성화 시 작업뷰 탭과 모달이 추가됩니다.</p>

        <div style={{display:'grid', gap:12}}>
          {plugins.map(p => (
            <div key={p.id} style={{background:'var(--bg-elev)', border: p.enabled ? '1px solid var(--accent-soft)' : '1px solid var(--border)', borderRadius:6, padding:16, borderLeft: p.enabled ? '3px solid var(--accent)' : '3px solid var(--border-strong)'}}>
              <div style={{display:'flex', alignItems:'start', gap:12}}>
                <div style={{width:40, height:40, borderRadius:6, background: p.enabled ? 'var(--accent-soft)' : 'var(--bg-panel-2)', color: p.enabled ? 'var(--accent-strong)' : 'var(--text-3)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                  <I.Plug size={18}/>
                </div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:2}}>
                    <strong style={{fontSize:13}}>{p.name}</strong>
                    <span className="badge mono" style={{fontSize:10}}>v{p.ver}</span>
                    <span className="badge">{p.vendor}</span>
                    <div style={{flex:1}}/>
                    <label style={{display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer'}}>
                      <span style={{width:32, height:18, background: p.enabled ? 'var(--accent)' : 'var(--border-strong)', borderRadius:9, position:'relative', transition:'background 120ms'}}>
                        <span style={{position:'absolute', left: p.enabled ? 16 : 2, top:2, width:14, height:14, background:'white', borderRadius:'50%', transition:'left 120ms'}}/>
                      </span>
                    </label>
                  </div>
                  <div style={{fontSize:11, color:'var(--text-2)', marginBottom:10}}>{p.desc}</div>
                  <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                    {p.features.map(f => <span key={f} className="chip">{f}</span>)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.PluginsView = PluginsView;
