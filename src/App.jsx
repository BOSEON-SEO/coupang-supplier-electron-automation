import React, { useState } from 'react';
import TabNav from './components/TabNav';
import WebView from './components/WebView';
import WorkView from './components/WorkView';

const TABS = [
  { id: 'webview', label: '웹 뷰' },
  { id: 'workview', label: '작업 뷰' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('webview');

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">쿠팡 서플라이어 자동화</h1>
      </header>

      <TabNav tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="app-main">
        {activeTab === 'webview' && <WebView />}
        {activeTab === 'workview' && <WorkView />}
      </main>
    </div>
  );
}
