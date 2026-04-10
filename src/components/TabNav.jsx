import React from 'react';

/**
 * 탭 네비게이션 컴포넌트
 * @param {{ tabs: {id:string, label:string}[], activeTab: string, onTabChange: (id:string)=>void }} props
 */
export default function TabNav({ tabs, activeTab, onTabChange }) {
  return (
    <nav className="tab-nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab-btn ${activeTab === tab.id ? 'tab-btn--active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
