import React from 'react';
import VendorSelector from '../components/VendorSelector';
import { I } from '../icons/v4-icons';

/**
 * v4 헤더 — 목업 일치 레이아웃.
 *   [● Coupang Inbound v4]  [breadcrumb]   ──── spacer ────   [license?] [로그] [웹뷰?] [플러그인 N] [vendor]
 *
 * 중앙 view-switch nav 는 없음. 설정/플러그인은 calendar 사이드바 시스템 섹션 OR 헤더 우측의
 * 플러그인 버튼으로만 진입. settings/plugins 진입 시 "← 달력" 백 링크를 breadcrumb 자리에 노출.
 */
export default function AppHeader({
  view, onViewChange,
  pluginsEnabled, pluginCount = 0,
  activeJob, poListDate,
  vendor, onVendorChange, vendors,
  webOpen, onToggleWeb,
  logOpen, onToggleLog,
  license, onOpenLicense,
}) {
  const activeVendorMeta = (vendors || []).find((v) => v.id === activeJob?.vendor);
  const activeVendorName = activeVendorMeta?.name || activeJob?.vendor || '';

  const showBackToCalendar = view === 'settings' || view === 'plugins';

  return (
    <header className="shell-header">
      <div className="shell-header__title">
        <span className="dot" />
        Coupang Inbound
        <span className="ver">v4</span>
      </div>

      {showBackToCalendar && (
        <button
          type="button"
          className="shell-header__back"
          onClick={() => onViewChange('calendar')}
          title="달력으로"
        >
          <I.ChevronL size={13} />
          <span>달력으로</span>
        </button>
      )}

      <div className="shell-header__crumb">
        {view === 'calendar' && <span className="active">달력</span>}
        {view === 'po-list' && (
          <>
            <span style={{ color: 'var(--text-3)' }}>달력</span>
            <span className="sep">/</span>
            <span className="active">
              <I.Calendar size={12} stroke="var(--text-2)" /> {poListDate || ''} PO
            </span>
          </>
        )}
        {view === 'work' && activeJob && (
          <>
            <span style={{ color: 'var(--text-3)' }}>달력</span>
            <span className="sep">/</span>
            <span style={{ color: 'var(--text-3)' }}>{activeJob.date} PO</span>
            <span className="sep">/</span>
            <span className="active">
              {activeVendorMeta?.color && (
                <span className="swatch" style={{ background: activeVendorMeta.color }} />
              )}
              {activeVendorName} · {activeJob.sequence}차
            </span>
          </>
        )}
        {view === 'settings' && <span className="active">설정</span>}
        {view === 'plugins' && <span className="active">플러그인</span>}
      </div>

      <div className="shell-header__spacer" />

      {license?.status === 'near-expiry' && (
        <button
          type="button"
          className="shell-header__hbtn"
          style={{
            color: 'var(--warn)',
            borderColor: 'oklch(from var(--warn) l c h / 0.4)',
            background: 'var(--warn-soft)',
          }}
          onClick={onOpenLicense}
          title="라이선스 만료 임박"
        >
          <I.AlertTriangle size={13} /> 라이선스 갱신
        </button>
      )}

      <button
        type="button"
        className={'shell-header__hbtn' + (logOpen ? ' active' : '')}
        onClick={onToggleLog}
        title="실행 로그"
      >
        <I.Terminal size={13} /> 로그
      </button>

      {view === 'work' && (
        <button
          type="button"
          className={'shell-header__hbtn' + (webOpen ? ' active' : '')}
          onClick={onToggleWeb}
          title="웹뷰 토글"
        >
          <I.Globe size={13} /> 웹뷰
        </button>
      )}

      {pluginsEnabled && (
        <button
          type="button"
          className={'shell-header__hbtn' + (view === 'plugins' ? ' active' : '')}
          onClick={() => onViewChange('plugins')}
          title="플러그인"
        >
          <I.Plug size={13} /> 플러그인
          {pluginCount > 0 && <span className="shell-header__hbtn-badge">{pluginCount}</span>}
        </button>
      )}

      <VendorSelector value={vendor} onChange={onVendorChange} />
    </header>
  );
}
