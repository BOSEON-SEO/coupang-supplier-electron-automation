import React from 'react';
import { I } from './icons';
import SettingsView from '../components/SettingsView';

/**
 * 설정 페이지 — 좌측 사이드바(뒤로가기) + 본문(legacy SettingsView).
 * 모달이 아닌 풀 페이지로 렌더. 데이터는 window.electronAPI.loadSettings/saveSettings
 * 와 SettingsView 내부에서 직접 IPC 동기화.
 */
export default function SettingsPage({ vendor, onBack }) {
  return (
    <div className="cal-shell" style={{ flexDirection: 'row' }}>
      <aside className="cal-sidebar">
        <button className="sb-back" onClick={onBack} title="달력으로">
          <I.ChevronL size={13} />
          <span>달력으로</span>
        </button>
        <div className="cal-sb-section">시스템</div>
        <div style={{ padding: '6px 10px', fontSize: 11, color: '#A1A1AA' }}>
          벤더 / 자동화 / 플러그인 / 라이선스
        </div>
      </aside>
      <div className="cal-shell">
        <div className="cal-header">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I.Settings size={16} stroke="var(--text-2)" />
            설정
          </h1>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 18 }}>
          <SettingsView activeVendor={vendor?.id} />
        </div>
      </div>
    </div>
  );
}
