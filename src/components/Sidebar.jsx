import React from 'react';

/**
 * 좌측 사이드바 — 메인 view 전환.
 *
 * Props:
 *   - activeView: 'calendar' | 'work' | 'settings' | 'plugins'
 *   - onChange: (view) => void
 *   - workActive: boolean — 작업 컨텍스트가 잡혀있을 때만 'work' 메뉴 활성화
 *   - pluginsEnabled: boolean — false 면 🔌 플러그인 메뉴 숨김 (설정 → 고급)
 */

export default function Sidebar({
  activeView,
  onChange,
  workActive = false,
  pluginsEnabled = true,
}) {
  const items = [
    { id: 'calendar', icon: '📅', label: '달력' },
    { id: 'work', icon: '📋', label: '작업' },
    { id: 'settings', icon: '⚙', label: '설정' },
    ...(pluginsEnabled ? [{ id: 'plugins', icon: '🔌', label: '플러그인' }] : []),
  ];
  return (
    <nav className="app-sidebar">
      {items.map((it) => {
        const disabled = it.id === 'work' && !workActive;
        return (
          <button
            key={it.id}
            type="button"
            className={`app-sidebar__item${activeView === it.id ? ' is-active' : ''}`}
            onClick={() => !disabled && onChange(it.id)}
            disabled={disabled}
            title={disabled ? '먼저 달력에서 작업을 선택하세요' : it.label}
            aria-label={it.label}
          >
            <span className="app-sidebar__icon">{it.icon}</span>
            <span className="app-sidebar__label">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
