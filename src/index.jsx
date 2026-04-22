import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import StockAdjustApp from './StockAdjustApp';
import TransportApp from './TransportApp';
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
const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {route.name === 'stock-adjust' && <StockAdjustApp params={route.params} />}
    {route.name === 'transport'    && <TransportApp    params={route.params} />}
    {route.name === 'main'         && <App />}
  </React.StrictMode>
);
