import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegistrySnapshot, usePluginRuntime } from '../core/plugin-host';
import { listLoadedPlugins } from '../core/plugin-registry';
import { listInstalledManifests } from '../core/plugin-loader';

/**
 * 플러그인 메뉴 — 설치된 플러그인 전체 목록 + 시스템 현황.
 *
 * 각 플러그인의 개별 설정은 '상세' 버튼 → 모달에서 편집.
 */
export default function PluginsView() {
  const counts = useRegistrySnapshot();
  const runtime = usePluginRuntime();
  const loaded = listLoadedPlugins();
  const installed = useMemo(() => listInstalledManifests(), []);

  const [pluginsSettings, setPluginsSettings] = useState({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [detailOf, setDetailOf] = useState(null); // plugin.id | null

  const reload = useCallback(async () => {
    const res = await window.electronAPI?.loadSettings();
    const all = res?.settings || {};
    setPluginsSettings(all.plugins || {});
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    reload();
    const onChanged = () => reload();
    window.addEventListener('settings-changed', onChanged);
    return () => window.removeEventListener('settings-changed', onChanged);
  }, [reload]);

  const rowsByState = useMemo(() => {
    const loadedIds = new Set(loaded.map((p) => p.id));
    return installed.map((m) => {
      const userEnabled = pluginsSettings?.[m.id]?.enabled !== false;
      const isLoaded = loadedIds.has(m.id);
      let state;
      if (isLoaded) state = 'loaded';
      else if (!userEnabled) state = 'user-disabled';
      else state = 'entitlement';
      return { ...m, userEnabled, state };
    });
  }, [installed, loaded, pluginsSettings]);

  const handleToggle = useCallback(async (pluginId, nextEnabled) => {
    const api = window.electronAPI;
    if (!api) return;
    const cur = await api.loadSettings();
    const curSettings = cur?.settings || {};
    const curPlugins = curSettings.plugins || {};
    const nextPlugins = {
      ...curPlugins,
      [pluginId]: { ...(curPlugins[pluginId] || {}), enabled: nextEnabled },
    };
    const res = await api.saveSettings({
      schemaVersion: cur?.schemaVersion || 1,
      settings: { ...curSettings, plugins: nextPlugins },
    });
    if (res?.success) {
      window.dispatchEvent(new Event('settings-changed'));
    }
  }, []);

  const detailPlugin = detailOf ? installed.find((p) => p.id === detailOf) : null;

  return (
    <div className="plugins-view">
      <div className="plugins-view__header">
        <h2>🔌 플러그인</h2>
      </div>

      <div className="plugins-view__body">
        <section className="plugins-view__section">
          <h3 className="plugins-view__section-title">시스템 현황</h3>
          <div className="plugins-stats">
            <Stat label="로드된 플러그인" value={counts.plugins} />
            <Stat label="등록된 커맨드" value={counts.commands} />
            <Stat label="등록된 뷰" value={counts.views} />
            <Stat label="등록된 훅" value={counts.hooks} />
            <Stat label="등록된 phase" value={counts.phases} />
          </div>
        </section>

        <section className="plugins-view__section">
          <h3 className="plugins-view__section-title">런타임 컨텍스트</h3>
          <div className="plugins-kv">
            <div className="plugins-kv__row">
              <span className="plugins-kv__key">현재 벤더</span>
              <code className="plugins-kv__value">{runtime.currentVendor || '(미선택)'}</code>
            </div>
            <div className="plugins-kv__row">
              <span className="plugins-kv__key">Entitlements</span>
              <code className="plugins-kv__value">
                {runtime.entitlements.length
                  ? runtime.entitlements.join(', ')
                  : '(비어있음 — 마스터 토글 OFF)'}
              </code>
            </div>
          </div>
        </section>

        <section className="plugins-view__section">
          <h3 className="plugins-view__section-title">설치된 플러그인</h3>
          {rowsByState.length === 0 ? (
            <p className="plugins-view__empty">설치된 플러그인이 없습니다.</p>
          ) : (
            <table className="plugins-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>이름</th>
                  <th>버전</th>
                  <th>권한</th>
                  <th>상태</th>
                  <th>활성화</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rowsByState.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.id}</code></td>
                    <td>{p.name}</td>
                    <td>{p.version}</td>
                    <td>
                      {p.entitlement
                        ? <code className="plugins-badge plugins-badge--ent">{p.entitlement}</code>
                        : <span className="plugins-muted">–</span>}
                    </td>
                    <td>
                      {p.state === 'loaded' && <span className="plugins-badge plugins-badge--active">로드됨</span>}
                      {p.state === 'user-disabled' && <span className="plugins-badge plugins-badge--off">비활성</span>}
                      {p.state === 'entitlement' && <span className="plugins-badge plugins-badge--locked">권한 부족</span>}
                    </td>
                    <td>
                      <label className="plugins-toggle" title={p.userEnabled ? '클릭하여 비활성화' : '클릭하여 활성화'}>
                        <input
                          type="checkbox"
                          checked={p.userEnabled}
                          disabled={!settingsLoaded}
                          onChange={(e) => handleToggle(p.id, e.target.checked)}
                        />
                        <span className="plugins-toggle__slider" />
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--secondary btn--xs"
                        onClick={() => setDetailOf(p.id)}
                      >
                        상세
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {detailPlugin && (
        <PluginDetailModal
          plugin={detailPlugin}
          onClose={() => setDetailOf(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="plugins-stat">
      <div className="plugins-stat__value">{value}</div>
      <div className="plugins-stat__label">{label}</div>
    </div>
  );
}

/**
 * 플러그인 상세 모달 — 설명 + 개별 설정 폼 + 저장/닫기.
 * 설정 폼은 manifest.settingsSchema 기반 자동 렌더.
 */
function PluginDetailModal({ plugin, onClose }) {
  const [values, setValues] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await window.electronAPI?.loadSettings();
      if (cancelled) return;
      const all = res?.settings || {};
      const mine = (all.plugins && all.plugins[plugin.id]) || {};
      // 'enabled' 은 목록의 스위치로 관리하므로 폼에서 제외
      const { enabled, ...rest } = mine;
      setValues(rest);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [plugin.id]);

  const handleChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    setSaving(true);
    setStatus('');
    try {
      const cur = await api.loadSettings();
      const curSettings = cur?.settings || {};
      const curPlugins = curSettings.plugins || {};
      const existing = curPlugins[plugin.id] || {};
      const nextForPlugin = { ...existing, ...values };
      const res = await api.saveSettings({
        schemaVersion: cur?.schemaVersion || 1,
        settings: { ...curSettings, plugins: { ...curPlugins, [plugin.id]: nextForPlugin } },
      });
      if (!res?.success) throw new Error(res?.error || 'settings save 실패');
      setStatus('저장됨');
      window.dispatchEvent(new Event('settings-changed'));
    } catch (err) {
      setStatus(`저장 실패: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(''), 2500);
    }
  }, [plugin.id, values]);

  const schema = Array.isArray(plugin.settingsSchema) ? plugin.settingsSchema : [];

  return (
    <div className="plugin-detail-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="plugin-detail-overlay__card" onClick={(e) => e.stopPropagation()}>
        <header className="plugin-detail-overlay__header">
          <div>
            <h3 className="plugin-detail-overlay__title">
              {plugin.name}
              <span className="plugin-detail-overlay__id"><code>{plugin.id}</code></span>
              <span className="plugin-detail-overlay__version">v{plugin.version}</span>
            </h3>
            {plugin.entitlement && (
              <div className="plugin-detail-overlay__ent">
                권한: <code>{plugin.entitlement}</code>
              </div>
            )}
          </div>
          <button type="button" className="plugin-detail-overlay__close" onClick={onClose}>×</button>
        </header>

        <div className="plugin-detail-overlay__body">
          {plugin.description && (
            <section className="plugin-detail-overlay__desc">
              {plugin.description}
            </section>
          )}

          <section className="plugin-detail-overlay__settings">
            <div className="plugin-detail-overlay__section-title">설정</div>
            {schema.length === 0 ? (
              <p className="plugins-muted">이 플러그인은 설정 항목이 없습니다.</p>
            ) : !loaded ? (
              <p className="plugins-muted">불러오는 중…</p>
            ) : (
              <div className="plugin-settings">
                {schema.map((field) => (
                  <PluginSettingField
                    key={field.key}
                    field={field}
                    value={values[field.key]}
                    onChange={handleChange}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="plugin-detail-overlay__footer">
          {status && <span className="plugin-settings__status">{status}</span>}
          <div className="plugin-detail-overlay__footer-spacer" />
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            disabled={saving}
          >
            닫기
          </button>
          {schema.length > 0 && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleSave}
              disabled={saving || !loaded}
            >
              💾 {saving ? '저장 중...' : '저장'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function PluginSettingField({ field, value, onChange }) {
  const effective = value !== undefined ? value : field.default;

  if (field.type === 'boolean') {
    return (
      <label className="plugin-settings__row plugin-settings__row--toggle">
        <input
          type="checkbox"
          checked={!!effective}
          onChange={(e) => onChange(field.key, e.target.checked)}
        />
        <div>
          <div className="plugin-settings__label">{field.label}</div>
          {field.description && <div className="plugin-settings__hint">{field.description}</div>}
        </div>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="plugin-settings__row">
        <label className="plugin-settings__label">{field.label}</label>
        <textarea
          className="plugin-settings__input plugin-settings__input--textarea"
          placeholder={field.placeholder || ''}
          value={effective ?? ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          rows={4}
        />
        {field.description && <div className="plugin-settings__hint">{field.description}</div>}
      </div>
    );
  }

  const inputType = field.type === 'password' ? 'password'
    : field.type === 'number' ? 'number'
      : field.type === 'url' ? 'url'
        : 'text';

  return (
    <div className="plugin-settings__row">
      <label className="plugin-settings__label">{field.label}</label>
      <input
        type={inputType}
        className="plugin-settings__input"
        placeholder={field.placeholder || ''}
        value={effective ?? ''}
        onChange={(e) => onChange(field.key, field.type === 'number'
          ? (e.target.value === '' ? '' : Number(e.target.value))
          : e.target.value)}
      />
      {field.description && <div className="plugin-settings__hint">{field.description}</div>}
    </div>
  );
}
