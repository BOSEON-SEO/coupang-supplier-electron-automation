// Plugin Manager Modal
import React from 'react';
import { I } from './icons';

export function PluginManager({ plugins, setPlugins, onClose }) {
  const togglePlugin = (id) => {
    setPlugins(ps => ps.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  return (
    <div className="overlay">
      <div className="modal plugin-modal">
        <div className="modal-head">
          <h3><I.Plug size={14} stroke="var(--plugin)"/>플러그인 관리</h3>
          <div className="sub">플러그인은 검토 컬럼 추가, 새 단계 삽입, 인박스 도구 추가 등으로 작업 흐름을 확장합니다.</div>
        </div>
        <div className="modal-body">
          <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.6, fontWeight:600, marginBottom:8}}>설치됨</div>
          {plugins.filter(p => p.purchased).map(p => (
            <div key={p.id} className={'plugin-card' + (p.enabled ? ' installed' : '')}>
              <div className="icon" style={{background: p.color}}>{p.initial}</div>
              <div className="body">
                <div className="name">
                  {p.name}
                  <span className="mono" style={{fontSize:10, color:'var(--text-3)', fontWeight:400}}>v{p.version}</span>
                  {p.enabled && <span className="badge ok">활성</span>}
                </div>
                <div className="desc">{p.description}</div>
                <div className="hooks">
                  {p.hooks.map(h => <span key={h} className="badge plugin" style={{fontFamily:'JetBrains Mono', fontSize:10}}>{h}</span>)}
                </div>
                <div className="meta">mode: {p.mode}</div>
              </div>
              <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8}}>
                <div className={'switch' + (p.enabled ? ' on' : '')} onClick={() => togglePlugin(p.id)}/>
                <button className="btn ghost sm" style={{fontSize:10, padding:'2px 6px', height:'auto'}}>설정</button>
              </div>
            </div>
          ))}

          <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.6, fontWeight:600, marginTop:18, marginBottom:8}}>마켓플레이스</div>
          {plugins.filter(p => !p.purchased).map(p => (
            <div key={p.id} className="plugin-card">
              <div className="icon" style={{background: p.color}}>{p.initial}</div>
              <div className="body">
                <div className="name">{p.name} <span className="mono" style={{fontSize:10, color:'var(--text-3)', fontWeight:400}}>v{p.version}</span></div>
                <div className="desc">{p.description}</div>
                <div className="hooks">
                  {p.hooks.map(h => <span key={h} className="badge plugin" style={{fontFamily:'JetBrains Mono', fontSize:10}}>{h}</span>)}
                </div>
                <div className="meta">mode: {p.mode}</div>
              </div>
              <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8}}>
                <div className="mono" style={{fontSize:13, fontWeight:600}}>₩{p.price.toLocaleString()}</div>
                <button className="btn plugin sm">구매</button>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// Plugin takeover — modal overlay (replaces old DraggableWindow-based PluginWindow)
export function PluginTakeover({ onClose }) {
  return (
    <div className="overlay">
      <div className="plugin-takeover">
        <div className="plugin-takeover-head">
          <span className="plugin-badge"><I.Plug size={10}/>PLUGIN</span>
          <h3>tbnws · 어드민 동기화</h3>
          <span className="mono ver">v1.2.0</span>
          <div style={{flex:1}}/>
          <button className="x" onClick={onClose}><I.Close size={13}/></button>
        </div>
        <div className="plugin-takeover-body" style={{padding:24, overflow:'auto', background:'oklch(0.99 0.01 320)'}}>
        <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:18}}>
          <div style={{width:40, height:40, borderRadius:8, background:'var(--plugin)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:16}}>T</div>
          <div>
            <div style={{fontSize:16, fontWeight:600}}>어드민 동기화</div>
            <div style={{fontSize:11, color:'var(--text-3)'}}>tbnws에서 추가한 단계 — 작업 마치면 메인 창 잠금이 풀립니다</div>
          </div>
        </div>

        <div style={{background:'white', border:'1px solid var(--border)', borderRadius:6, padding:16, marginBottom:14}}>
          <div style={{fontSize:12, fontWeight:600, marginBottom:10}}>tbnws 어드민에 반영할 항목 (4건)</div>
          <table className="gtable" style={{width:'100%'}}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>상품명</th>
                <th style={{textAlign:'right'}}>확정수량</th>
                <th>유통기한</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {[
                {sku:'4549292221', name:'캐논 컬러 잉크', q:32, exp:'2027-12', st:'대기'},
                {sku:'4549292062', name:'캐논 정품 잉크', q:432, exp:'2027-08', st:'대기'},
                {sku:'4549292068', name:'캐논 PIXMA', q:64, exp:'2028-03', st:'대기'},
                {sku:'4549292255', name:'캐논 가정용 13L', q:17, exp:'2027-11', st:'대기'},
              ].map(r => (
                <tr key={r.sku}>
                  <td className="mono" style={{fontSize:11}}>{r.sku}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.q}</td>
                  <td className="mono" style={{fontSize:11}}>{r.exp}</td>
                  <td><span className="badge plugin">{r.st}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{padding:'10px 14px', background:'var(--plugin-soft)', borderRadius:5, fontSize:12, color:'var(--plugin)', display:'flex', alignItems:'flex-start', gap:8, marginBottom:14}}>
          <I.Info size={13} style={{flexShrink:0, marginTop:1}}/>
          <span><strong>이 작업이 진행되는 동안 메인 창은 잠겨 있습니다.</strong> 플러그인이 코어 데이터에 변경을 가하기 때문입니다. 완료 후 잠금이 자동 해제되고 다음 단계로 넘어갑니다.</span>
        </div>

        <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
          <button className="btn ghost" onClick={onClose}>건너뛰기</button>
          <button className="btn plugin" onClick={onClose}><I.Send size={13}/> tbnws 어드민에 반영</button>
        </div>
        </div>
      </div>
    </div>
  );
}

