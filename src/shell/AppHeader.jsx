import React from 'react';
import VendorSelector from '../components/VendorSelector';

/**
 * v4 단일 윈도우 셸의 상단 바 (M1).
 *
 *   [● Coupang Inbound v4]  [달력] [작업] [설정] [플러그인]   ── breadcrumb ──   [VENDOR] [웹뷰] [License]
 *
 * 기존 Sidebar 의 네비를 헤더 nav 버튼으로 흡수. webview 토글은 현재 view 가 'work' 일 때만 의미가 있어
 * WorkDetailView 내부 토글 버튼은 그대로 두고, 헤더에는 단축 토글만 노출.
 *
 * Props:
 *   view, onViewChange — 'calendar' | 'work' | 'settings' | 'plugins'
 *   workActive — 활성 작업이 있을 때만 '작업' 탭 활성화 가능
 *   pluginsEnabled — 플러그인 글로벌 on/off (off 면 탭 숨김)
 *   activeJob — work 모드일 때 breadcrumb 에 표시
 *   vendor, onVendorChange, vendors — 헤더 벤더 셀렉터
 *   webOpen, onToggleWeb — work 모드일 때만 표시
 *   license — near-expiry 시 배지로 알림
 *   onOpenLicense — 클릭 시 setView('settings') 같은 핸들러
 */
export default function AppHeader({
  view, onViewChange,
  workActive, pluginsEnabled,
  activeJob,
  vendor, onVendorChange, vendors,
  webOpen, onToggleWeb,
  license, onOpenLicense,
}) {
  const vendorMeta = (vendors || []).find((v) => v.id === activeJob?.vendor);
  const vendorName = vendorMeta?.name || activeJob?.vendor || '';

  return (
    <header className="shell-header">
      <div className="shell-header__title">
        <span className="dot" />
        Coupang Inbound
        <span className="ver">v4</span>
      </div>

      <nav className="shell-header__nav">
        <button
          type="button"
          className={'shell-header__navbtn' + (view === 'calendar' ? ' active' : '')}
          onClick={() => onViewChange('calendar')}
        >
          📅 달력
        </button>
        <button
          type="button"
          className={'shell-header__navbtn' + (view === 'work' ? ' active' : '')}
          onClick={() => onViewChange('work')}
          disabled={!workActive}
          title={workActive ? '활성 작업으로 이동' : '활성 작업이 없습니다'}
        >
          🛠 작업
        </button>
        <button
          type="button"
          className={'shell-header__navbtn' + (view === 'settings' ? ' active' : '')}
          onClick={() => onViewChange('settings')}
        >
          ⚙ 설정
        </button>
        {pluginsEnabled && (
          <button
            type="button"
            className={'shell-header__navbtn' + (view === 'plugins' ? ' active' : '')}
            onClick={() => onViewChange('plugins')}
          >
            🔌 플러그인
          </button>
        )}
      </nav>

      {view === 'work' && activeJob && (
        <div className="shell-header__crumb">
          <span className="sep">/</span>
          <span>{vendorName}</span>
          <span className="sep">/</span>
          <span style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{activeJob.date}</span>
          <span className="sep">/</span>
          <span>{activeJob.sequence}차</span>
          {activeJob.completed && (
            <span style={{
              marginLeft: 6, padding: '1px 6px', borderRadius: 3,
              background: 'var(--ok-soft)', color: 'var(--ok)',
              fontSize: 10, fontWeight: 600,
            }}>완료</span>
          )}
        </div>
      )}

      <div className="shell-header__spacer" />

      {license?.status === 'near-expiry' && (
        <button
          type="button"
          className="shell-header__hbtn"
          style={{ color: 'var(--warn)', borderColor: 'oklch(from var(--warn) l c h / 0.4)', background: 'var(--warn-soft)' }}
          onClick={onOpenLicense}
          title="라이선스 만료 임박"
        >
          ⚠ 라이선스 갱신
        </button>
      )}

      {view === 'work' && (
        <button
          type="button"
          className={'shell-header__hbtn' + (webOpen ? ' active' : '')}
          onClick={onToggleWeb}
          title="웹뷰 토글"
        >
          🌐 웹뷰
        </button>
      )}

      <VendorSelector value={vendor} onChange={onVendorChange} />
    </header>
  );
}
