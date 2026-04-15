import React, { useState } from 'react';
import TabNav from './components/TabNav';
import WebView from './components/WebView';
import WorkView from './components/WorkView';
import VendorSelector from './components/VendorSelector';

const TABS = [
  { id: 'webview', label: '웹 뷰' },
  { id: 'workview', label: '작업 뷰' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('webview');
  const [vendor, setVendor] = useState('');

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">쿠팡 서플라이어 자동화</h1>
        <VendorSelector value={vendor} onChange={setVendor} />
      </header>

      <TabNav tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="app-main">
        {activeTab === 'webview' && <WebView vendor={vendor} />}
        {activeTab === 'workview' && <WorkView vendor={vendor} />}
      </main>
    </div>
  );
}
