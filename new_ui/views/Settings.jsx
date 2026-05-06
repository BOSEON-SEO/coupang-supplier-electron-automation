// Settings view
function SettingsView() {
  const { VENDORS } = window.MOCK;
  return (
    <div style={{flex:1, overflow:'auto', background:'var(--bg-panel-2)'}}>
      <div className="settings-wrap">
        <h2 style={{margin:'0 0 4px', fontSize:20, fontWeight:600, letterSpacing:-0.3}}>설정</h2>
        <p style={{margin:'0 0 24px', color:'var(--text-3)', fontSize:12}}>벤더, 자격증명, 마스터 데이터, 라이선스, 플러그인을 관리합니다.</p>

        <div className="settings-section">
          <h3 style={{display:'flex', alignItems:'center', gap:8}}><I.Building size={14}/> 벤더 관리 <span className="badge" style={{marginLeft:4}}>{VENDORS.length}</span><div style={{flex:1}}/><button className="btn sm primary" style={{marginRight:0}}><I.Plus size={12}/> 벤더 추가</button></h3>
          <div className="body" style={{padding:0}}>
            {VENDORS.map((v, i) => (
              <div key={v.id} style={{display:'grid', gridTemplateColumns:'auto 1fr auto auto auto', gap:12, alignItems:'center', padding:'10px 16px', borderBottom: i < VENDORS.length-1 ? '1px solid var(--border-soft)' : 'none'}}>
                <div style={{width:32, height:32, borderRadius:6, background: v.color, color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700}}>{v.initial}</div>
                <div>
                  <div style={{fontSize:13, fontWeight:600}}>{v.name}</div>
                  <div style={{fontSize:11, color:'var(--text-3)'}} className="mono">{v.id} · partition_{v.id}</div>
                </div>
                <span className="badge ok"><I.CheckCircle size={11}/> 인증됨</span>
                <span className="mono" style={{fontSize:11, color:'var(--text-3)'}}>마지막 로그인 4분 전</span>
                <button className="btn ghost sm"><I.MoreH size={14}/></button>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h3 style={{display:'flex', alignItems:'center', gap:8}}><I.Key size={14}/> 자격증명</h3>
          <div className="body">
            <div className="settings-row"><div className="label">기본 벤더</div><select style={{height:30, padding:'0 10px', border:'1px solid var(--border-strong)', borderRadius:4, width:240, background:'white'}}>{VENDORS.map(v => <option key={v.id}>{v.name}</option>)}</select></div>
            <div className="settings-row"><div className="label">쿠팡 ID</div><input type="text" defaultValue="canon_admin_2024" style={{height:30, padding:'0 10px', border:'1px solid var(--border-strong)', borderRadius:4, width:240, background:'white', fontFamily:'JetBrains Mono', fontSize:12}}/></div>
            <div className="settings-row"><div className="label">비밀번호</div>
              <div style={{display:'flex', gap:6}}>
                <input type="password" defaultValue="●●●●●●●●●●●●" style={{height:30, padding:'0 10px', border:'1px solid var(--border-strong)', borderRadius:4, width:240, background:'white'}}/>
                <button className="btn sm"><I.Eye size={13}/></button>
                <button className="btn sm">변경</button>
              </div>
            </div>
            <div className="settings-row"><div className="label">2단계 인증</div>
              <label style={{display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer'}}>
                <span style={{width:32, height:18, background:'var(--accent)', borderRadius:9, position:'relative'}}>
                  <span style={{position:'absolute', right:2, top:2, width:14, height:14, background:'white', borderRadius:'50%'}}/>
                </span>
                <span style={{fontSize:12}}>SMS 인증 사용</span>
              </label>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3 style={{display:'flex', alignItems:'center', gap:8}}><I.Pallet size={14}/> 마스터 데이터</h3>
          <div className="body">
            <div className="settings-row"><div className="label">출고지 프리셋</div><div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
              {['평택공장','안성공장','인천창고','부산물류'].map(x => <span key={x} className="chip">{x} <I.X size={10} style={{marginLeft:2}}/></span>)}
              <button className="chip" style={{background:'var(--accent-soft)', color:'var(--accent-strong)', borderColor:'var(--accent-soft)'}}><I.Plus size={11}/> 추가</button>
            </div></div>
            <div className="settings-row"><div className="label">팔레트 프리셋</div><div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
              {[{n:'T11', b:48},{n:'T12', b:60},{n:'유럽', b:36},{n:'미니', b:24}].map(x => (
                <span key={x.n} className="chip mono" style={{fontSize:10}}>{x.n} · {x.b}박스 <I.X size={10} style={{marginLeft:2}}/></span>
              ))}
            </div></div>
            <div className="settings-row"><div className="label">기본 운송방법</div><div style={{display:'flex', gap:4}}>
              <button className="chip">자동 판단</button>
              <button className="chip active">밀크런 우선</button>
              <button className="chip">쉽먼트 우선</button>
            </div></div>
          </div>
        </div>

        <div className="settings-section">
          <h3 style={{display:'flex', alignItems:'center', gap:8}}><I.Lock size={14}/> 라이선스</h3>
          <div className="body">
            <div style={{display:'flex', gap:12, alignItems:'start'}}>
              <div style={{flex:1, padding:14, background:'oklch(0.96 0.04 60)', border:'1px solid oklch(0.85 0.06 60)', borderRadius:5}}>
                <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:6}}>
                  <I.AlertTriangle size={14} stroke="oklch(0.55 0.16 60)"/>
                  <strong style={{fontSize:12, color:'oklch(0.42 0.14 60)'}}>만료 임박 — 14일 남음</strong>
                </div>
                <div style={{fontSize:11, color:'var(--text-2)'}}>현재 라이선스: <span className="mono">PRO-2025-CANON-A91F</span></div>
                <div style={{fontSize:11, color:'var(--text-2)'}}>만료일: <span className="mono">2026-05-14</span> · 4 벤더 · 무제한 차수</div>
              </div>
              <button className="btn primary">갱신하기</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.SettingsView = SettingsView;
