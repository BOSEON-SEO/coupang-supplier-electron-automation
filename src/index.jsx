import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import StockAdjustApp from './StockAdjustApp';
import TransportApp from './TransportApp';
import { PluginProvider } from './core/plugin-host';
import { bootstrapPlugins } from './core/plugin-loader';
import { resolveEntitlementsFromLicense } from './core/entitlements';
import './styles/global.css';
import './styles/v4.css';

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

/**
 * Popup 윈도우용 래퍼 — 설정을 async 로 로드한 뒤 entitlements 계산 +
 * 플러그인 부트스트랩. settings-changed 이벤트로 재로드도 처리.
 * Main 윈도우의 App 은 자체적으로 설정·bootstrap 처리하므로 여기서는 popup 만.
 */
function PopupShell({ children, vendor }) {
  const [entitlements, setEntitlements] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const reload = async () => {
      const [sRes, lRes] = await Promise.all([
        window.electronAPI?.loadSettings?.(),
        window.electronAPI?.license?.get?.(),
      ]);
      if (cancelled) return;
      const settings = sRes?.settings || {};
      const license = lRes?.license || null;
      const ents = resolveEntitlementsFromLicense(license);
      setEntitlements(ents);
      const perPluginEnabled = {};
      const ps = settings?.plugins || {};
      for (const [id, conf] of Object.entries(ps)) {
        if (conf && conf.enabled === false) perPluginEnabled[id] = false;
      }
      bootstrapPlugins({
        entitlements: ents,
        currentVendor: vendor || null,
        electronAPI: window.electronAPI,
        perPluginEnabled,
      });
      setReady(true);
    };
    reload();
    const onSettings = () => reload();
    const offLicense = window.electronAPI?.license?.onChanged?.(() => reload());
    window.addEventListener('settings-changed', onSettings);
    return () => {
      cancelled = true;
      window.removeEventListener('settings-changed', onSettings);
      if (typeof offLicense === 'function') offLicense();
    };
  }, [vendor]);

  if (!ready) return null;
  return (
    <PluginProvider entitlements={entitlements} currentVendor={vendor || null}>
      {children}
    </PluginProvider>
  );
}

const popupVendor = route.params?.vendor || null;

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {route.name === 'stock-adjust' && (
      <PopupShell vendor={popupVendor}>
        <StockAdjustApp params={route.params} />
      </PopupShell>
    )}
    {route.name === 'transport' && (
      <PopupShell vendor={popupVendor}>
        <TransportApp params={route.params} />
      </PopupShell>
    )}
    {route.name === 'main' && <App />}
  </React.StrictMode>
);
