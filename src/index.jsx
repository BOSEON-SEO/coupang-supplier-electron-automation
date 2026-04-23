import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import StockAdjustApp from './StockAdjustApp';
import TransportApp from './TransportApp';
import { PluginProvider } from './core/plugin-host';
import { bootstrapPlugins } from './core/plugin-loader';
import { DEV_ENTITLEMENTS } from './core/entitlements';
import './styles/global.css';

// hash 기반 라우팅 — 새 BrowserWindow 도 같은 index.html 을 재사용
function parseRoute() {
  const h = String(window.location.hash || '');
  const parseQs = () => {
    const qIdx = h.indexOf('?');
    const qs = qIdx >= 0 ? h.slice(qIdx + 1) : '';
    return Object.fromEntries(new URLSearchParams(qs));
  };
  if (h.startsWith('#/stock-adjust')) return { name: 'stock-adjust', params: parseQs() };
  if (h.startsWith('#/transport'))    return { name: 'transport',    params: parseQs() };
  return { name: 'main' };
}

const route = parseRoute();

// Popup 윈도우(stock-adjust / transport) 는 별도 React 트리라서 이 쪽에서도
// 플러그인을 부트스트랩해야 ViewOutlet/SlotRenderer 가 동작함.
// Main 윈도우의 App 컴포넌트는 자체적으로 bootstrapPlugins 를 호출함.
if (route.name === 'stock-adjust' || route.name === 'transport') {
  bootstrapPlugins({
    entitlements: DEV_ENTITLEMENTS,
    currentVendor: route.params?.vendor || null,
    electronAPI: window.electronAPI,
  });
}

const popupVendor = route.params?.vendor || null;

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {route.name === 'stock-adjust' && (
      <PluginProvider entitlements={DEV_ENTITLEMENTS} currentVendor={popupVendor}>
        <StockAdjustApp params={route.params} />
      </PluginProvider>
    )}
    {route.name === 'transport' && (
      <PluginProvider entitlements={DEV_ENTITLEMENTS} currentVendor={popupVendor}>
        <TransportApp params={route.params} />
      </PluginProvider>
    )}
    {route.name === 'main' && <App />}
  </React.StrictMode>
);
