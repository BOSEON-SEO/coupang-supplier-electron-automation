import React from 'react';
import AppHeader from './AppHeader';

/**
 * v4 단일 윈도우 셸 컨테이너 (M1).
 *
 *   ┌──────────────────────── shell-header ─────────────────────────┐
 *   │ [title] [달력|작업|설정|플러그인]  [crumb]  ...  [vendor 등]  │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │  shell-license-banner (near-expiry 일 때)                     │
 *   ├──────────────────────── shell-body ───────────────────────────┤
 *   │                                                                │
 *   │  shell-main (children)                                         │
 *   │                                                                │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * 기존 Sidebar / .app-container 를 대체. Body 내부의 view (Calendar / Work / Settings / Plugins)
 * 는 그대로 children 으로 받아 렌더. M3/M4 에서 각 view 도 v4 디자인으로 갈아엎음.
 *
 * Props 는 AppHeader 가 필요로 하는 것들 + children + license banner 클릭 핸들러.
 */
export default function AppShell({
  view, onViewChange,
  pluginsEnabled, pluginCount,
  activeJob, poListDate,
  vendor, onVendorChange, vendors,
  webOpen, onToggleWeb,
  logOpen, onToggleLog,
  license, onOpenLicense,
  children,
}) {
  return (
    <div className="shell-root">
      <AppHeader
        view={view}
        onViewChange={onViewChange}
        pluginsEnabled={pluginsEnabled}
        pluginCount={pluginCount}
        activeJob={activeJob}
        poListDate={poListDate}
        vendor={vendor}
        onVendorChange={onVendorChange}
        vendors={vendors}
        webOpen={webOpen}
        onToggleWeb={onToggleWeb}
        logOpen={logOpen}
        onToggleLog={onToggleLog}
        license={license}
        onOpenLicense={onOpenLicense}
      />

      {license?.status === 'near-expiry' && (
        <div className="shell-license-banner">
          <span>⚠</span>
          <span>
            라이선스가 곧 만료됩니다 ({new Date(license.expiredAt).toLocaleDateString('ko-KR')}).
            관리자에게 갱신 요청한 후 아래에서 재검증하세요.
          </span>
          <button
            type="button"
            className="shell-license-banner__action"
            onClick={onOpenLicense}
          >
            설정 → 라이선스
          </button>
        </div>
      )}

      <div className="shell-body">
        <main className="shell-main">
          {children}
        </main>
      </div>
    </div>
  );
}
