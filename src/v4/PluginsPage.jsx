import React from 'react';
import { I } from './icons';
import PluginsView from '../components/PluginsView';

/**
 * 플러그인 페이지 — 좌측 사이드바(뒤로가기) + 본문(legacy PluginsView).
 * legacy PluginsView 내부에서 listInstalledManifests / useRegistrySnapshot /
 * usePluginRuntime / window.electronAPI.loadSettings 로 실 플러그인 데이터 동기화.
 * 각 플러그인의 개별 설정은 legacy PluginsView 내부 모달로 동작.
 */
export default function PluginsPage({ vendor, onBack }) {
  return (
    <div className="cal-shell" style={{ flexDirection: 'row' }}>
      <aside className="cal-sidebar">
        <button className="sb-back" onClick={onBack} title="달력으로">
          <I.ChevronL size={13} />
          <span>달력으로</span>
        </button>
        <div className="cal-sb-section">플러그인</div>
        <div style={{ padding: '6px 10px', fontSize: 11, color: '#A1A1AA' }}>
          시스템 현황 · 설치 목록 · 개별 설정
        </div>
      </aside>
      <div className="cal-shell">
        <div className="cal-header">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I.Plug size={16} stroke="var(--text-2)" />
            플러그인
          </h1>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 0 }}>
          <PluginsView />
        </div>
      </div>
    </div>
  );
}
